import subprocess
import os
import sys
import uuid
from pathlib import Path
from langchain.tools import tool

ARTIFACTS_DIR = Path("artifacts")
ARTIFACTS_DIR.mkdir(exist_ok=True)

@tool
def run_python_code(code: str) -> str:
    """Execute Python code and return the output. Use for calculations, data processing, plotting charts.
    IMPORTANT FOR CHARTS: Save charts with plt.savefig('chart.png'). The chart will be AUTOMATICALLY displayed to the user - you do NOT need to output any image links, markdown images, or 'click here' text. After the code runs, simply describe what the chart shows in plain text."""
    artifact_id = str(uuid.uuid4())[:8]
    work_dir = ARTIFACTS_DIR / artifact_id
    work_dir.mkdir(exist_ok=True)
    
    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=work_dir
        )
        output = result.stdout or ""
        if result.returncode != 0:
            output = f"Error: {result.stderr}"
    except subprocess.TimeoutExpired:
        return "Error: Code execution timed out after 60 seconds. Try simplifying the code or reducing iterations."
    
    images = list(work_dir.glob("*.png")) + list(work_dir.glob("*.jpg")) + list(work_dir.glob("*.svg"))
    if images:
        image_paths = [f"http://localhost:8000/artifacts/{artifact_id}/{img.name}" for img in images]
        output += f"\n[ARTIFACTS:{','.join(image_paths)}]"
    
    return output or "Code executed successfully (no output)"

@tool
def read_file(path: str) -> str:
    """Read contents of a file from disk."""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

@tool
def write_file(path: str, content: str) -> str:
    """Write content to a file on disk."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return f"File written: {path}"

@tool
def list_directory(path: str = ".") -> str:
    """List files and folders in a directory."""
    items = os.listdir(path)
    return "\n".join(items)


def get_tools():
    return [run_python_code, read_file, write_file, list_directory]
