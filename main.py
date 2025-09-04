from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(title="AvukatAjanda API", version="1.0.0")

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

# Database models ve gerçek endpoints eklenecek
from typing import List, Optional
from pydantic import BaseModel

class Client(BaseModel):
    id: Optional[int] = None
    name: str
    email: str
    phone: str

class Case(BaseModel):
    id: Optional[int] = None
    case_no: str
    title: str
    client_id: int
    status: str = "active"

# Geçici veri deposu (production'da PostgreSQL kullanılacak)
clients_db = []
cases_db = []

@app.post("/api/clients")
def create_client(client: Client):
    client.id = len(clients_db) + 1
    clients_db.append(client)
    return client

@app.get("/api/clients")
def get_clients():
    return clients_db

@app.post("/api/cases")
def create_case(case: Case):
    case.id = len(cases_db) + 1
    cases_db.append(case)
    return case

@app.get("/api/cases")
def get_cases():
    return cases_db
