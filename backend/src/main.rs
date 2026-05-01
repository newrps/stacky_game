use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

#[derive(Clone)]
struct AppState {
    rooms: Arc<RwLock<HashMap<String, Arc<Room>>>>,
}

struct Room {
    id: String,
    seed: u64,
    capacity: u8,
    /// 룸 안 모든 클라이언트에게 broadcast (게임 이벤트, 채팅 등)
    tx: broadcast::Sender<String>,
    players: RwLock<HashMap<String, PlayerInfo>>,
}

#[derive(Serialize, Clone, Debug)]
struct PlayerInfo {
    id: String,
    name: String,
    /// 가장 최근 본 보드 상태 — 가벼운 스냅샷
    last_state: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct RoomDto {
    id: String,
    seed: u64,
    capacity: u8,
    players: Vec<PlayerInfo>,
}

impl Room {
    fn snapshot(&self, players: Vec<PlayerInfo>) -> RoomDto {
        RoomDto {
            id: self.id.clone(),
            seed: self.seed,
            capacity: self.capacity,
            players,
        }
    }
}

#[derive(Deserialize)]
struct CreateRoomReq {
    #[serde(default)]
    capacity: Option<u8>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,ps_tetris_backend=debug,tower_http=info".into()),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8772);

    let state = Arc::new(AppState {
        rooms: Arc::new(RwLock::new(HashMap::new())),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/rooms", get(list_rooms).post(create_room))
        .route("/api/rooms/:id", get(get_room))
        .route("/ws/room/:id", get(ws_room))
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{port}");
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn list_rooms(State(state): State<Arc<AppState>>) -> Json<Vec<RoomDto>> {
    let r = state.rooms.read().await;
    let mut out = Vec::with_capacity(r.len());
    for room in r.values() {
        let players = room.players.read().await.values().cloned().collect();
        out.push(room.snapshot(players));
    }
    Json(out)
}

async fn create_room(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateRoomReq>,
) -> Json<RoomDto> {
    let id = nanoid::nanoid!(6);
    let seed: u64 = rand_u64();
    let (tx, _) = broadcast::channel(256);
    let room = Arc::new(Room {
        id: id.clone(),
        seed,
        capacity: req.capacity.unwrap_or(4).clamp(2, 8),
        tx,
        players: RwLock::new(HashMap::new()),
    });
    state.rooms.write().await.insert(id.clone(), room.clone());
    tracing::info!("room created: {id} (seed={seed})");
    Json(room.snapshot(vec![]))
}

async fn get_room(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<RoomDto>, (axum::http::StatusCode, &'static str)> {
    let r = state.rooms.read().await;
    let room = r
        .get(&id)
        .ok_or((axum::http::StatusCode::NOT_FOUND, "room not found"))?;
    let players = room.players.read().await.values().cloned().collect();
    Ok(Json(room.snapshot(players)))
}

async fn ws_room(
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, id, state))
}

async fn handle_ws(socket: WebSocket, room_id: String, state: Arc<AppState>) {
    let room = match state.rooms.read().await.get(&room_id).cloned() {
        Some(r) => r,
        None => {
            tracing::warn!("ws connect to missing room {room_id}");
            return;
        }
    };

    let (mut sender, mut receiver) = socket.split();
    let player_id = nanoid::nanoid!(8);
    let player_name = format!("Player-{}", &player_id[..4]);

    // 입장 처리
    {
        let mut p = room.players.write().await;
        p.insert(
            player_id.clone(),
            PlayerInfo {
                id: player_id.clone(),
                name: player_name.clone(),
                last_state: None,
            },
        );
    }

    // 환영 메시지 — seed, 자기 ID, 현재 룸 정보
    let players = room.players.read().await.values().cloned().collect::<Vec<_>>();
    let welcome = serde_json::json!({
        "type": "welcome",
        "you": player_id,
        "seed": room.seed,
        "room": room.snapshot(players),
    });
    let _ = sender.send(Message::Text(welcome.to_string())).await;

    // 입장 broadcast
    let join_msg = serde_json::json!({
        "type": "join",
        "player": { "id": player_id, "name": player_name },
    });
    let _ = room.tx.send(join_msg.to_string());

    // broadcast 수신용 task
    let mut rx = room.tx.subscribe();
    let send_task_player_id = player_id.clone();
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            // 자기가 보낸 메시지는 제외하지 않음 (단순화)
            // 필요 시 메시지에 sender id 넣어서 client에서 필터
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
            // 응답 저자 표시 (디버그)
            let _ = send_task_player_id;
        }
    });

    // 클라이언트로부터 받은 메시지 처리
    let tx = room.tx.clone();
    let pid = player_id.clone();
    let room_for_recv = room.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(t) => {
                    // sender id 주입 후 broadcast
                    let mut v: serde_json::Value = match serde_json::from_str(&t) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if let Some(obj) = v.as_object_mut() {
                        obj.insert("from".into(), serde_json::Value::String(pid.clone()));
                    }
                    // 보드 스냅샷이면 룸 상태에 캐시
                    if v.get("type").and_then(|x| x.as_str()) == Some("state") {
                        if let Some(snap) = v.get("snapshot") {
                            let mut p = room_for_recv.players.write().await;
                            if let Some(info) = p.get_mut(&pid) {
                                info.last_state = Some(snap.clone());
                            }
                        }
                    }
                    let _ = tx.send(v.to_string());
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // 둘 중 하나 종료될 때까지
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }

    // 퇴장 처리
    {
        let mut p = room.players.write().await;
        p.remove(&player_id);
    }
    let leave_msg = serde_json::json!({
        "type": "leave",
        "player": { "id": player_id, "name": player_name },
    });
    let _ = room.tx.send(leave_msg.to_string());

    // 빈 방 청소
    let mut rooms = state.rooms.write().await;
    if let Some(r) = rooms.get(&room_id) {
        if r.players.read().await.is_empty() {
            rooms.remove(&room_id);
            tracing::info!("room {room_id} emptied — removed");
        }
    }
}

fn rand_u64() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ (d.as_secs() as u64).rotate_left(17))
        .unwrap_or(0);
    nanos ^ 0x9E37_79B9_7F4A_7C15
}
