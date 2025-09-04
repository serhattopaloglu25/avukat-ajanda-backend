from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

@app.get("/api/clients")
def get_clients():
    return []

@app.get("/api/cases")
def get_cases():
    return []

@app.get("/api/calendar")
def get_calendar():
    return []
