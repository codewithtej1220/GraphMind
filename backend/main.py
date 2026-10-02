"""
GraphMind Standard — FastAPI backend.

Endpoints:
    GET  /api/health          - liveness check
    POST /api/parse           - source code -> {nodes, edges} structural AST graph (all languages)
    POST /api/trace           - source code -> step-by-step execution frames (all languages)
    POST /api/complexity      - source code -> empirical Big-O benchmark (all languages)

Run locally:
    uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from parsers.ast_parser import parse_code_to_graph
from tracer.execution import run_complexity_benchmark, trace_execution
from github_import import repository_file, repository_files
from storage import create_session, delete_session, get_session, list_sessions

FRONTEND_ORIGINS = [origin.strip() for origin in os.environ.get(
    "FRONTEND_ORIGIN", "http://localhost:3000"
).split(",") if origin.strip()]

app = FastAPI(
    title="GraphMind Standard API",
    description="Code inspection & execution visualizer backend",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ParseRequest(BaseModel):
    code: str = Field(..., max_length=200_000, description="Source code to parse")
    language: str = Field(..., description="Language identifier")


class ParseResponse(BaseModel):
    nodes: list[dict]
    edges: list[dict]
    hasError: bool


class TraceRequest(BaseModel):
    code: str = Field(..., max_length=200_000, description="Source code to execute and trace")
    language: str = Field(..., description="Language identifier")
    input: str = Field(default="", max_length=20_000, description="Newline-separated stdin")


class LoopInfo(BaseModel):
    var: str | None
    iteration: int
    total: int | None


class CallInfo(BaseModel):
    function: str
    args: dict | None = None
    value: object | None = None


class TraceFrame(BaseModel):
    step: int
    activeLine: int
    event: str
    operation: str
    description: str
    callStack: list[str]
    variables: dict
    arrayName: str | None
    arrayState: list
    pointers: dict
    loop: LoopInfo | None
    callInfo: CallInfo | None
    arrays: dict = Field(default_factory=dict)
    accessed: dict = Field(default_factory=dict)


class TraceResponse(BaseModel):
    supported: bool
    message: str | None
    frames: list[TraceFrame]
    stdout: str
    error: str | None
    diagnosis: dict | None = None


class ComplexityRequest(BaseModel):
    code: str = Field(..., max_length=200_000, description="Source code to benchmark across N")
    language: str = Field(..., description="Language identifier")
    input: str = Field(default="", max_length=20_000, description="Newline-separated stdin")


class ComplexityResponse(BaseModel):
    supported: bool
    message: str | None
    n_values: list[int]
    step_counts: list[int]
    estimated_big_o: str | None
    error: str | None

class SessionRequest(BaseModel):
    name: str = Field(default="Untitled analysis", max_length=120)
    language: str
    code: str = Field(max_length=200_000)

class GitHubImportRequest(BaseModel):
    url: str = Field(max_length=500)

class GitHubFileRequest(GitHubImportRequest):
    path: str = Field(max_length=500)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/parse", response_model=ParseResponse)
def parse(payload: ParseRequest) -> ParseResponse:
    try:
        graph = parse_code_to_graph(payload.code, payload.language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ParseResponse(**graph)


@app.post("/api/trace", response_model=TraceResponse)
def trace(payload: TraceRequest) -> TraceResponse:
    result = trace_execution(payload.code, payload.language, payload.input)
    return TraceResponse(**result)


@app.post("/api/complexity", response_model=ComplexityResponse)
def complexity(payload: ComplexityRequest) -> ComplexityResponse:
    result = run_complexity_benchmark(payload.code, payload.language, payload.input)
    return ComplexityResponse(**result)

@app.get("/api/sessions")
def sessions() -> list[dict]: return list_sessions()

@app.post("/api/sessions", status_code=201)
def save_session(payload: SessionRequest) -> dict: return create_session(payload.name, payload.language, payload.code)

@app.get("/api/sessions/{session_id}")
def session(session_id: str) -> dict:
    result=get_session(session_id)
    if result is None: raise HTTPException(status_code=404, detail="Session not found")
    return result

@app.delete("/api/sessions/{session_id}")
def remove_session(session_id: str) -> dict:
    if not delete_session(session_id): raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}

@app.post("/api/github/import")
async def github_import(payload: GitHubImportRequest) -> dict:
    try: return await repository_files(payload.url, os.environ.get("GITHUB_TOKEN"))
    except ValueError as exc: raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.post("/api/github/file")
async def github_file(payload: GitHubFileRequest) -> dict:
    try: return await repository_file(payload.url, payload.path, os.environ.get("GITHUB_TOKEN"))
    except ValueError as exc: raise HTTPException(status_code=400, detail=str(exc)) from exc
