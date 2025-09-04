from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import uvicorn

app = FastAPI(title="AvukatAjanda API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "AvukatAjanda API", "status": "active"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/stats")
def get_stats():
    return {
        "total_cases": 12,
        "active_cases": 8,
        "total_clients": 45,
        "pending_invoices": 3
    }

@app.get("/api/clients")
def get_clients():
    return []

@app.get("/api/cases")
def get_cases():
    return []

@app.get("/api/calendar")
def get_calendar():
    return []

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
