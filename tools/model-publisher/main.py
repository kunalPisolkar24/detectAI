import sys
import argparse
from src.core.config import settings
from src.infrastructure.huggingface_adapter import HuggingFaceRegistry
from src.application.publisher import ModelPublisher
from src.core.exceptions import MLException

def bootstrap() -> ModelPublisher:
    registry = HuggingFaceRegistry(
        token=settings.hf_token,
        username=settings.hf_username
    )
    return ModelPublisher(registry)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Model name (e.g., detect-ai-spark)")
    parser.add_argument("--version", required=True, help="Version tag (e.g., v1.0.0)")
    
    args = parser.parse_args()

    try:
        publisher = bootstrap()
        print(f"Starting publication for {args.model} @ {args.version}")
        publisher.publish(args.model, args.version)
        print("Publication completed successfully.")
        
    except MLException as e:
        print(f"Operation failed: {str(e)}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()