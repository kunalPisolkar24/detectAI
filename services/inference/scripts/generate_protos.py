import sys
import subprocess
from pathlib import Path

def generate_protos():
    project_root = Path(__file__).parent.parent
    proto_path = project_root / "protos" / "ai_service.proto"
    output_dir = project_root / "src" / "generated"

    if not proto_path.exists():
        print(f"Error: Proto file not found at {proto_path}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)
    
    command = [
        sys.executable, "-m", "grpc_tools.protoc",
        f"-I{project_root / 'protos'}",
        f"--python_out={output_dir}",
        f"--grpc_python_out={output_dir}",
        str(proto_path)
    ]

    try:
        subprocess.check_call(command)
    except subprocess.CalledProcessError as e:
        print(f"Error generating protos: {e}")
        sys.exit(1)

    grpc_file = output_dir / "ai_service_pb2_grpc.py"
    if grpc_file.exists():
        with open(grpc_file, "r") as f:
            content = f.read()
        
        new_content = content.replace(
            "import ai_service_pb2 as ai__service__pb2", 
            "from . import ai_service_pb2 as ai__service__pb2"
        )
        
        with open(grpc_file, "w") as f:
            f.write(new_content)

    init_file = output_dir / "__init__.py"
    if not init_file.exists():
        init_file.touch()

    print(f"Successfully generated protos in {output_dir}")

if __name__ == "__main__":
    generate_protos()