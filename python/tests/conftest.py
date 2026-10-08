import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
# Test against the source tree, installed or not.
sys.path.insert(0, str(ROOT / "python" / "src"))

VECTORS = json.loads((ROOT / "spec" / "test-vectors.json").read_text(encoding="utf-8"))


@pytest.fixture
def vectors():
    return VECTORS
