"""
Настройка путей для тестов: чтобы `import src...` работал при запуске
pytest из корня AI/ или из папки tests/.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
