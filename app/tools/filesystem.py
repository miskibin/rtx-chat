import os
from pathlib import Path
from langchain.tools import tool

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
    return "\n".join(os.listdir(path))


def get_filesystem_tools():
    return [read_file, write_file, list_directory]
