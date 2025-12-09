import subprocess
import sys
import uuid
from pathlib import Path
from langchain.tools import tool

ARTIFACTS_DIR = Path("artifacts")
ARTIFACTS_DIR.mkdir(exist_ok=True)


@tool
def run_python_code(code: str) -> str:
    """Execute Python code and return the output. Use for calculations, data processing, plotting charts.
    IMPORTANT FOR CHARTS: Save charts with plt.savefig('chart.png'). The chart will be AUTOMATICALLY displayed.
    """
    artifact_id = str(uuid.uuid4())[:8]
    work_dir = ARTIFACTS_DIR / artifact_id
    work_dir.mkdir(exist_ok=True)
    
    wrapped_code = f"import matplotlib;matplotlib.use('Agg')\n{code}"

    result = subprocess.run(
        [sys.executable, "-c", wrapped_code],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=work_dir,
    )
    output = result.stdout or ""
    if result.returncode != 0:
        output = f"Error: {result.stderr}"

    images = list(work_dir.glob("*.png")) + list(work_dir.glob("*.jpg")) + list(work_dir.glob("*.svg"))
    if images:
        image_paths = [f"http://localhost:8000/artifacts/{artifact_id}/{img.name}" for img in images]
        output += f"\n[ARTIFACTS:{','.join(image_paths)}]"

    return output or "Code executed successfully (no output)"


def get_code_tools():
    return [run_python_code]
