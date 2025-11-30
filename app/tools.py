import subprocess
import os
from langchain.tools import tool

@tool
def run_python_code(code: str) -> str:
    """Execute Python code and return the output. Use for calculations, data processing, etc."""
    result = subprocess.run(
        ["python", "-c", code],
        capture_output=True,
        text=True,
        timeout=30
    )
    if result.returncode != 0:
        return f"Error: {result.stderr}"
    return result.stdout or "Code executed successfully (no output)"

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

@tool
def calculator(expression: str) -> str:
    """Evaluate a mathematical expression. Use Python syntax (e.g., '2**10', 'math.sqrt(16)')."""
    import math
    result = eval(expression, {"__builtins__": {}, "math": math})
    return str(result)

def get_tools():
    return [run_python_code, read_file, write_file, list_directory, calculator]
