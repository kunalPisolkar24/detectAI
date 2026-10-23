from fastapi import FastAPI

app = FastAPI(title="Document Parser")


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/ready")
def ready() -> dict[str, str]:
    return {"status": "ready"}
