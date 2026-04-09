import argparse
import os
import subprocess
import sys
from pathlib import Path


def load_env_file(env_file):
    values = {}

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


def repo_root():
    return Path(__file__).resolve().parents[4]


def build_token(repo_dir, secret):
    command = [
        sys.executable,
        "services/inference/load/scripts/generate_token.py",
        "--secret",
        secret,
    ]

    result = subprocess.run(
        command,
        cwd=repo_dir,
        check=True,
        capture_output=True,
        text=True,
    )

    return result.stdout.strip()


def docker_command(args, repo_dir, target, token):
    image = args.image or os.environ.get("K6_DOCKER_IMAGE", "grafana/k6:latest")
    command = [
        "docker",
        "run",
        "--rm",
        "-i",
        "--add-host",
        "host.docker.internal:host-gateway",
        "-v",
        f"{repo_dir}:/workspace",
        "-w",
        "/workspace",
        "-e",
        f"INFERENCE_LOAD_GRPC_TARGET={target}",
        "-e",
        f"INFERENCE_LOAD_AUTH_TOKEN={token}",
    ]

    for name, value in sorted(os.environ.items()):
        if name.startswith("INFERENCE_LOAD_") and name not in {
            "INFERENCE_LOAD_GRPC_TARGET",
            "INFERENCE_LOAD_AUTH_TOKEN",
        }:
            command.extend(["-e", f"{name}={value}"])
            continue

        if name.startswith("K6_"):
            command.extend(["-e", f"{name}={value}"])

    command.append(image)
    command.append(args.command)
    command.extend(args.k6_args)
    command.append(args.script)
    return command


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--script", required=True)
    parser.add_argument("--command", default="run")
    parser.add_argument("--image")
    parser.add_argument("k6_args", nargs=argparse.REMAINDER)
    return parser.parse_args()


def main():
    args = parse_args()
    repo_dir = repo_root()
    env_path = (repo_dir / args.env_file).resolve()

    if not env_path.exists():
        raise FileNotFoundError(f"Env file not found: {args.env_file}")

    env_values = load_env_file(env_path)
    secret = env_values.get("AI_SERVICE_API_KEY")
    port = env_values.get("PORT_INFERENCE", "50051")

    if not secret:
        raise ValueError("AI_SERVICE_API_KEY is required in the env file")

    target = os.environ.get("INFERENCE_LOAD_GRPC_TARGET", f"host.docker.internal:{port}")
    token = os.environ.get("INFERENCE_LOAD_AUTH_TOKEN") or build_token(repo_dir, secret)
    k6_args = list(args.k6_args)

    if k6_args and k6_args[0] == "--":
        k6_args = k6_args[1:]

    args.k6_args = k6_args
    command = docker_command(args, repo_dir, target, token)
    result = subprocess.run(command, cwd=repo_dir)
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
