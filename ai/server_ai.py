from fastapi import FastAPI, Request
from sentence_transformers import SentenceTransformer, util

app = FastAPI(title="AI Matching API")

# Load mô hình (dùng e5-small-v2 hoặc bge-small-en-v1.5)
model = SentenceTransformer("intfloat/e5-small-v2")

@app.get("/")
def root():
    return {"message": "AI Matching API is running!"}

@app.post("/match")
async def match_goals(request: Request):
    data = await request.json()
    goals = data.get("goals", [])
    if len(goals) < 2:
        return {"error": "Cần ít nhất 2 mục tiêu để so sánh"}

    embeddings = model.encode(goals, convert_to_tensor=True)
    similarity = util.cos_sim(embeddings[0], embeddings[1]).item()
    return {
        "goal_1": goals[0],
        "goal_2": goals[1],
        "similarity_score": round(similarity, 3)
    }
