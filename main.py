from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import os

# Database import
from database import get_db, ClientDB, CaseDB, engine, Base

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="AvukatAjanda API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class Client(BaseModel):
    name: str
    email: str
    phone: str

class ClientResponse(Client):
    id: int
    
class Case(BaseModel):
    case_no: str
    title: str
    client_id: int
    status: str = "active"

class CaseResponse(Case):
    id: int

@app.get("/")
def read_root():
    return {"message": "AvukatAjanda API", "status": "active", "database": "connected"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/stats")
def get_stats(db: Session = Depends(get_db)):
    total_clients = db.query(ClientDB).count()
    total_cases = db.query(CaseDB).count()
    active_cases = db.query(CaseDB).filter(CaseDB.status == "active").count()
    
    return {
        "total_cases": total_cases,
        "active_cases": active_cases,
        "total_clients": total_clients,
        "pending_invoices": 3
    }

@app.post("/api/clients", response_model=ClientResponse)
def create_client(client: Client, db: Session = Depends(get_db)):
    db_client = ClientDB(**client.dict())
    db.add(db_client)
    db.commit()
    db.refresh(db_client)
    return db_client

@app.get("/api/clients", response_model=List[ClientResponse])
def get_clients(db: Session = Depends(get_db)):
    return db.query(ClientDB).all()

@app.post("/api/cases", response_model=CaseResponse)
def create_case(case: Case, db: Session = Depends(get_db)):
    db_case = CaseDB(**case.dict())
    db.add(db_case)
    db.commit()
    db.refresh(db_case)
    return db_case

@app.get("/api/cases", response_model=List[CaseResponse])
def get_cases(db: Session = Depends(get_db)):
    return db.query(CaseDB).all()

@app.get("/api/calendar")
def get_calendar():
    return []
