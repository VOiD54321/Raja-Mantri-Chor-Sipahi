from flask import Flask, request, jsonify
import random
import uuid

app = Flask(__name__)

# In-memory storage
rooms = {}

MAX_PLAYERS = 4
DEFAULT_POINTS = {
    "Raja": 1000,
    "Mantri": 800,
    "Sipahi": 500,
    "Chor": 0
}

# ----------------- Helpers -----------------
def generate_id():
    return str(uuid.uuid4())[:8]

def assign_roles(room):
    roles = ["Raja", "Mantri", "Chor", "Sipahi"]
    random.shuffle(roles)

    role_map = {}
    points = {}

    for player, role in zip(room["players"], roles):
        role_map[player["id"]] = role
        points[player["id"]] = DEFAULT_POINTS[role]

    room["round"] = {
        "roles": role_map,
        "points": points,
        "completed": False,
        "guess": None
    }

# ----------------- APIs -----------------

@app.route("/", methods=["GET"])
def home():
    return jsonify({"message": "RMCS Backend running"})

# Create Room
@app.route("/room/create", methods=["POST"])
def create_room():
    data = request.json
    room_id = generate_id()
    player_id = generate_id()

    rooms[room_id] = {
        "players": [{
            "id": player_id,
            "name": data["playerName"]
        }],
        "round": None,
        "scores": {player_id: 0}
    }

    return jsonify({"roomId": room_id, "playerId": player_id})

# Join Room
@app.route("/room/join", methods=["POST"])
def join_room():
    data = request.json
    room = rooms.get(data["roomId"])

    if not room:
        return jsonify({"error": "Room not found"}), 404

    if len(room["players"]) >= MAX_PLAYERS:
        return jsonify({"error": "Room full"}), 400

    player_id = generate_id()
    room["players"].append({"id": player_id, "name": data["playerName"]})
    room["scores"][player_id] = 0

    if len(room["players"]) == MAX_PLAYERS:
        assign_roles(room)

    return jsonify({"playerId": player_id})

# List Players
@app.route("/room/players/<room_id>")
def list_players(room_id):
    room = rooms.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404

    return jsonify(room["players"])

# Get My Role
@app.route("/role/me/<room_id>/<player_id>")
def my_role(room_id, player_id):
    room = rooms.get(room_id)
    if not room or not room["round"]:
        return jsonify({"role": None})

    role = room["round"]["roles"].get(player_id)
    return jsonify({"role": role})

# Mantri Guess
@app.route("/guess/<room_id>", methods=["POST"])
def guess_chor(room_id):
    data = request.json
    room_id = request.view_args['room_id']
    room = rooms.get(room_id)


    if not room or not room["round"]:
        return jsonify({"error": "No active round"}), 400

    roles = room["round"]["roles"]
    mantri_id = data["mantriId"]
    guessed_id = data["guessedId"]

    if roles.get(mantri_id) != "Mantri":
        return jsonify({"error": "Only Mantri can guess"}), 403

    correct = roles[guessed_id] == "Chor"

    if not correct:
        chor_id = [pid for pid, r in roles.items() if r == "Chor"][0]
        stolen = room["round"]["points"][mantri_id]
        room["round"]["points"][mantri_id] = 0
        room["round"]["points"][chor_id] += stolen

    # Update scores
    for pid, pts in room["round"]["points"].items():
        room["scores"][pid] += pts

    room["round"]["completed"] = True
    room["round"]["guess"] = correct

    return jsonify({"correct": correct})

# Results
@app.route("/result/<room_id>")
def result(room_id):
    room = rooms.get(room_id)
    if not room or not room["round"]:
        return jsonify({"error": "No round"}), 400

    result = []
    for p in room["players"]:
        pid = p["id"]
        result.append({
            "name": p["name"],
            "role": room["round"]["roles"].get(pid),
            "totalScore": room["scores"][pid]
        })

    return jsonify(result)

# Leaderboard
@app.route("/leaderboard/<room_id>")
def leaderboard(room_id):
    room = rooms.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404

    board = []
    for p in room["players"]:
        board.append({
            "name": p["name"],
            "score": room["scores"][p["id"]]
        })

    board.sort(key=lambda x: x["score"], reverse=True)
    return jsonify(board)

# ----------------- Run -----------------
if __name__ == "__main__":
    app.run(debug=True)
