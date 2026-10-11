"""Cross-edition parity checks — no JDK and no browser required.

    python3 tests/java_parity.py

The web, Python, Java and Android editions are meant to be one game: the same seed has to build the
same valley and a block has to look the same in all four. Those promises live in code, so this
script reads the sources of every edition and checks that the constants, the face table and the
shared Android/desktop Java modules have not drifted apart. CI runs it next to the smoke tests, and
the Java job separately compiles and runs the desktop edition.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
JAVA = ROOT / "java" / "pixeled3d"
ROCKZ = ROOT / "rockz-android" / "app" / "src" / "main" / "java" / "com" / "pixeled" / "rockz"
PYTHON = ROOT / "python" / "pixeled_game"
JAVA_TESTS = ROOT / "tests" / "java"

checks = 0
failures: list[str] = []


def check(ok: bool, what: str) -> None:
    global checks
    checks += 1
    if ok:
        print(f"  ok   {what}")
    else:
        failures.append(what)
        print(f"  FAIL {what}")


def heading(name: str) -> None:
    print(f"\n{name}")


# ------------------------------------------------------------------ reading sources


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def strip_comments(text: str) -> str:
    """Remove // and /* */ comments, keeping string literals intact."""
    out: list[str] = []
    index, length = 0, len(text)
    while index < length:
        char = text[index]
        if char == "/" and index + 1 < length and text[index + 1] == "/":
            while index < length and text[index] != "\n":
                index += 1
        elif char == "/" and index + 1 < length and text[index + 1] == "*":
            index += 2
            while index + 1 < length and not (text[index] == "*" and text[index + 1] == "/"):
                index += 1
            index += 2
        elif char == '"':
            start = index
            index += 1
            while index < length and text[index] != '"':
                index += 2 if text[index] == "\\" else 1
            index += 1
            out.append(text[start:index])
        else:
            out.append(char)
            index += 1
    return "".join(out)


def normalise_java(text: str) -> str:
    """A Java source reduced to what actually matters, for cross-module comparisons."""
    body = strip_comments(text)
    body = re.sub(r"^\s*package\s+[^;]+;", "", body, flags=re.MULTILINE)
    body = re.sub(r"^\s*import\s+[^;]+;", "", body, flags=re.MULTILINE)
    body = body.replace("WorldModel", "World")
    body = body.replace("public ", "")
    return re.sub(r"\s+", "", body)


def balanced(text: str) -> bool:
    pairs = {"}": "{", ")": "(", "]": "["}
    stack: list[str] = []
    for char in strip_comments(text):
        if char in "{([":
            stack.append(char)
        elif char in "})]":
            if not stack or stack[-1] != pairs[char]:
                return False
            stack.pop()
    return not stack


def numbers(text: str) -> set[str]:
    """Every numeric literal in a source file, normalised to a string."""
    stripped = strip_comments(text)
    return {match.rstrip("fFdD") for match in re.findall(r"\b\d+(?:\.\d+)?\b", stripped)}


# ------------------------------------------------------------------ package layout

def packages() -> None:
    heading("package layout")
    missing = []
    wrong_package = []
    sources = list((ROOT / "java").rglob("*.java")) + list((ROOT / "rockz-android").rglob("*.java"))
    sources += list(JAVA_TESTS.rglob("*.java"))
    for path in sources:
        text = read(path)
        package = re.search(r"^\s*package\s+([\w.]+);", text, flags=re.MULTILINE)
        if package is None:
            missing.append(str(path.relative_to(ROOT)))
            continue
        name = package.group(1)
        if "/pixeled3d/" in str(path) and name != "pixeled3d":
            wrong_package.append(f"{path.name} declares {name}")
        if "/com/pixeled/rockz/" in str(path) and name != "com.pixeled.rockz":
            wrong_package.append(f"{path.name} declares {name}")
    check(not missing, f"every Java source declares a package ({len(sources)} files)")
    check(not wrong_package, f"every package matches its folder ({'; '.join(wrong_package) or 'all match'})")
    check(all(balanced(read(path)) for path in sources), "every Java source is brace-balanced")
    check(all(balanced(read(path)) for path in WEB.glob("*.js")), "every web module is brace-balanced")


# ------------------------------------------------------------------ shared Java modules

def mirrored_modules() -> None:
    heading("desktop and Android share their world code")
    for name in ("Noise", "Blocks", "Generator", "Mesher"):
        desktop = normalise_java(read(JAVA / f"{name}.java"))
        android = normalise_java(read(ROCKZ / f"{name}.java"))
        check(desktop == android, f"rockz {name}.java mirrors the desktop module")

    for required in ("Pixeled.java", "Renderer.java", "Player.java", "Storage.java", "World.java"):
        check((JAVA / required).exists(), f"java/pixeled3d/{required} exists")
    for required in ("RockzView.java", "RockzRenderer.java", "PlayerModel.java", "TouchControls.java",
                     "WorldModel.java", "MainActivity.java"):
        check((ROCKZ / required).exists(), f"rockz {required} exists")
    check((JAVA_TESTS / "pixeled3d" / "PixeledSmoke.java").exists(),
          "the Java smoke test ships with the repo")


# ------------------------------------------------------------------ constants

def numbers_from_constant(text: str, name: str) -> list[float]:
    """The numbers of a `NAME = value` declaration, list or map entry."""
    line = next((line for line in strip_comments(text).splitlines() if name in line), "")
    return [float(value.rstrip("fFdD")) for value in re.findall(r"\d+(?:\.\d+)?", line)]


def constants() -> None:
    heading("shared constants")
    web_constants = read(WEB / "constants.js")
    java_blocks = read(JAVA / "Blocks.java")
    rockz_blocks = read(ROCKZ / "Blocks.java")
    python_blocks = read(PYTHON / "blocks.py")

    for name in ("CHUNK_SIZE", "WORLD_HEIGHT", "SEA_LEVEL"):
        web_value = numbers_from_constant(web_constants, f"export const {name}")
        java_value = numbers_from_constant(java_blocks, f"int {name}")
        python_value = numbers_from_constant(python_blocks, name.upper() + " =")
        check(web_value == java_value == python_value,
              f"{name} agrees across web, Java and Python ({web_value} / {java_value} / {python_value})")

    check(normalise_java(java_blocks) == normalise_java(rockz_blocks),
          "the Android block table is the desktop block table")

    java_array = re.search(r"TILE_COLORS = \{(.*?)\};", java_blocks, flags=re.DOTALL)
    java_colours = re.findall(r"0x([0-9a-f]{6})", java_array.group(1) if java_array else "")
    python_colours = re.findall(r'"#([0-9a-f]{6})"', python_blocks)
    check(java_colours == python_colours and len(java_colours) >= 20,
          f"the baked atlas colours match ({len(java_colours)} Java / {len(python_colours)} Python)")

    # Face shading: the web names three tints, the other editions map them onto six faces.
    web_shade = {name: value for name, value in
                 re.findall(r"(\w+):\s*([\d.]+)", web_constants.split("FACE_SHADE = {")[1].split("}")[0])}
    java_shade = {
        "top": numbers_from_constant(java_blocks, "FACE_SHADE_TOP")[0],
        "side": numbers_from_constant(java_blocks, "FACE_SHADE_Z")[0],
        "bottom": numbers_from_constant(java_blocks, "FACE_SHADE_BOTTOM")[0],
    }
    python_shade = dict(re.findall(r"\"(\w+)\": ([\d.]+)", python_blocks.split("FACE_SHADE = {")[1].split("}")[0]))
    check(float(web_shade["top"]) == java_shade["top"] == float(python_shade["top"]), "top faces are lit alike")
    check(float(web_shade["side"]) == java_shade["side"] == float(python_shade["north"]) == float(python_shade["east"]),
          "side faces are lit alike")
    check(float(web_shade["bottom"]) == java_shade["bottom"] == float(python_shade["bottom"]),
          "bottom faces are lit alike")

    hotbar_pages = re.findall(r"^\s*\{([A-Z_,\s]+)\},?$", java_blocks.split("HOTBAR_PAGES")[1].split("};")[0],
                              flags=re.MULTILINE)
    check(len(hotbar_pages) == 2 and all(len(page.split(",")) == 9 for page in hotbar_pages),
          "two pages of nine blocks in the hotbar")
    check("HOTBAR_PAGES" in web_constants and "HOTBAR_PAGES" in python_blocks, "the hotbar is shared by all editions")


# ------------------------------------------------------------------ mesher parity

def mesher_tables() -> None:
    heading("mesher parity")
    web_mesher = read(WEB / "mesher.js")
    java_mesher = read(JAVA / "Mesher.java")
    rockz_mesher = read(ROCKZ / "Mesher.java")
    python_mesher = read(PYTHON / "mesher.py")

    raw_faces = re.findall(
        r"name: '(\w+)', normal: \[(-?\d), (-?\d), (-?\d)\], base: \[(-?\d), (-?\d), (-?\d)\], "
        r"u: \[(-?\d), (-?\d), (-?\d)\], v: \[(-?\d), (-?\d), (-?\d)\]",
        web_mesher)
    web_faces = {
        name: {
            "normal": (int(a), int(b), int(c)),
            "base": (int(d), int(e), int(f)),
            "u": (int(g), int(h), int(i)),
            "v": (int(j), int(k), int(l)),
        }
        for name, a, b, c, d, e, f, g, h, i, j, k, l in raw_faces
    }
    check(len(web_faces) == 6, f"the web mesher describes six cube faces ({len(web_faces)})")

    java_faces = {}
    for line in java_mesher.splitlines():
        match = re.match(
            r'\s*face\("(\w+)", new int\[\]\{(-?\d), (-?\d), (-?\d)\}, new int\[\]\{(-?\d), (-?\d), (-?\d)\}, '
            r'new int\[\]\{(-?\d), (-?\d), (-?\d)\}, new int\[\]\{(-?\d), (-?\d), (-?\d)\}', line)
        if match:
            name = match.group(1)
            values = [int(value) for value in match.groups()[1:]]
            java_faces[name] = {
                "normal": tuple(values[0:3]),
                "base": tuple(values[3:6]),
                "u": tuple(values[6:9]),
                "v": tuple(values[9:12]),
            }
    check(len(java_faces) == 6, f"the Java mesher describes six cube faces ({len(java_faces)})")

    python_faces = {}
    for block in re.finditer(
            r'"(\w+)": \{"normal": \((-?\d), (-?\d), (-?\d)\),\s*"base": \((-?\d), (-?\d), (-?\d)\),\s*'
            r'"u": \((-?\d), (-?\d), (-?\d)\),\s*"v": \((-?\d), (-?\d), (-?\d)\)', python_mesher):
        groups = [int(value) for value in block.groups()[1:]]
        python_faces[block.group(1)] = {
            "normal": tuple(groups[0:3]),
            "base": tuple(groups[3:6]),
            "u": tuple(groups[6:9]),
            "v": tuple(groups[9:12]),
        }
    check(len(python_faces) == 6, f"the Python mesher describes six cube faces ({len(python_faces)})")

    alias = {"px": "east", "nx": "west", "py": "top", "ny": "bottom", "pz": "south", "nz": "north"}
    mismatch = []
    order_web = [alias[name] for name in web_faces]
    order_java = list(java_faces)
    order_python = list(python_faces)
    check(order_web == order_java == order_python,
          f"all editions emit the faces in the same order ({order_web})")
    for web_name, java_name in alias.items():
        web = web_faces[web_name]
        for other_name, table in (("java", java_faces), ("python", python_faces)):
            other = table[java_name]
            for key in ("normal", "base", "u", "v"):
                if web[key] != other[key]:
                    mismatch.append(f"{web_name}/{java_name} {key}: web {web[key]} vs {other_name} {other[key]}")
    check(not mismatch, f"the face table is identical in every edition ({'; '.join(mismatch) or 'all six faces'})")

    # The winding correction has to agree too: it decides the corner order and the AO signs.
    def corners(face):
        base, u, v = face["base"], face["u"], face["v"]
        points = [
            base,
            tuple(base[i] + u[i] for i in range(3)),
            tuple(base[i] + u[i] + v[i] for i in range(3)),
            tuple(base[i] + v[i] for i in range(3)),
        ]
        cross = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        if sum(cross[i] * face["normal"][i] for i in range(3)) < 0:
            points.reverse()
        return points

    web_corners = [corners(web_faces[name]) for name in web_faces]
    java_corners = [corners(java_faces[name]) for name in java_faces]
    python_corners = [corners(python_faces[name]) for name in python_faces]
    check(web_corners == java_corners == python_corners,
          "every edition winds its corners the same way (east and west get flipped)")

    for name in ("AO_LEVELS",):
        web_value = re.findall(r"[\d.]+", web_mesher.split(f"{name} = [")[1].split("]")[0])
        python_value = re.findall(r"[\d.]+", python_mesher.split(f"{name} = (")[1].split(")")[0])
        java_value = re.findall(r"[\d.]+", java_mesher.split(f"double[] {name} = {{")[1].split("}")[0])
        check(web_value == python_value == java_value,
              f"{name} is the same in every mesher ({web_value})")

    sky_web = numbers_from_constant(web_mesher, "SKY_SEARCH")
    sky_python = numbers_from_constant(python_mesher, "SKY_SEARCH")
    sky_java = numbers_from_constant(java_mesher, "SKY_SEARCH")
    check(value_of(sky_web) == value_of(sky_python) == value_of(sky_java) == 12.0,
          f"the skylight search depth matches across editions ({sky_web} / {sky_python} / {sky_java})")

    # The web sinks a liquid surface inline; the other editions name the same constant.
    drop_java = value_of(numbers_from_constant(java_mesher, "WATER_DROP"))
    drop_python = value_of(numbers_from_constant(python_mesher, "WATER_DROP"))
    check("0.12" in web_mesher and drop_java == 0.12 == drop_python,
          f"liquid surfaces sink by the same amount everywhere ({drop_java} / {drop_python})")

    for seed in ("7717", "991", "131"):
        check(seed in python_mesher and seed in java_mesher,
              f"the mesher uses the web hash seed {seed} in Java and Python")

    check(normalise_java(java_mesher) == normalise_java(rockz_mesher),
          "the Android mesher is the desktop mesher")


def value_of(values: list[float]) -> float | None:
    return values[0] if values else None


# ------------------------------------------------------------------ physics parity

PHYSICS_NAMES = ("WIDTH", "HEIGHT", "EYE_HEIGHT", "WALK_SPEED", "SPRINT_SPEED", "FLY_SPEED",
                 "GRAVITY", "JUMP_SPEED", "TERMINAL_VELOCITY")


def physics() -> None:
    heading("physics parity")
    web_player = read(WEB / "player.js")
    java_player = read(JAVA / "Player.java")
    rockz_player = read(ROCKZ / "PlayerModel.java")
    python_player = read(PYTHON / "player.py")

    def values(pattern: str, text: str) -> dict[str, float]:
        return {name: float(value) for name, value in re.findall(pattern, text)}

    web_values = values(r"static (\w+) = ([\d.]+)", web_player)
    java_values = values(r"double (\w+) = ([\d.]+)", java_player)
    rockz_values = values(r"double (\w+) = ([\d.]+)", rockz_player)
    python_values = values(r"(\w+) = ([\d.]+)", python_player)

    for name in PHYSICS_NAMES:
        web, java, android, python = (web_values.get(name), java_values.get(name),
                                      rockz_values.get(name), python_values.get(name))
        check(web is not None and web == java == android == python,
              f"{name} is the same everywhere ({web} / {java} / {android} / {python})")


# ------------------------------------------------------------------ generator parity

GENERATOR_MARKERS = (0.0075, 0.017, 0.0035, 0.48, 3.6, 46.0, 0.09, 2.4, 0.0055, 0.0072,
                     0.428, 1301, 0.6, 0.42, 0.012, 0.45)


def generator() -> None:
    heading("generator parity")
    python_generator = read(PYTHON / "generator.py")
    java_generator = read(JAVA / "Generator.java")
    rockz_generator = read(ROCKZ / "Generator.java")
    python_numbers = numbers(python_generator)
    java_numbers = numbers(java_generator)
    missing = [marker for marker in GENERATOR_MARKERS
               if f"{marker}" in python_numbers and f"{marker}" not in java_numbers]
    check(not missing, f"the Java generator keeps every web/Python terrain constant (missing: {missing or 'none'})")
    check(normalise_java(java_generator) == normalise_java(rockz_generator),
          "the Android generator is the desktop generator")

    for method in ("heightAt", "biomeAt", "carveCaves", "decorate"):
        check(method in java_generator, f"the Java generator implements {method}()")

    seed_hits = [line for line in java_generator.splitlines() if "hashFloat" in line or "hash3" in line
                 or "hash2" in line]
    check(len(seed_hits) >= 6, f"the Java generator hashes the same way ({len(seed_hits)} calls)")


# ------------------------------------------------------------------ the Java smoke test

def java_smoke() -> None:
    heading("the Java edition has a headless smoke test")
    smoke = read(JAVA_TESTS / "pixeled3d" / "PixeledSmoke.java")
    checklist = {
        "56, 55, 57, 68, 52, 54, 45, 38": "asserts the shared seed heights",
        "1485": "asserts the shared mesher counts",
        "358": "asserts the shared cutout faces",
        "90": "asserts the shared plant faces",
        "1933": "asserts the shared quad total",
        "findSpawn": "checks spawning",
        "raycast": "checks ray casting",
        "Storage": "checks saving",
        "Renderer": "checks the software renderer",
    }
    for needle, what in checklist.items():
        check(needle in smoke, f"the Java smoke test {what}")
    check("System.exit(1)" in smoke and "java smoke test passed" in smoke,
          "and fails the build when something is wrong")


def main() -> int:
    packages()
    mirrored_modules()
    constants()
    mesher_tables()
    physics()
    generator()
    java_smoke()
    print()
    if failures:
        print(f"java parity check failed — {len(failures)} of {checks} checks")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print(f"java parity check passed — {checks} checks, every edition still the same game")
    return 0


if __name__ == "__main__":
    sys.exit(main())
