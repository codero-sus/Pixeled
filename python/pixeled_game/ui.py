"""A tiny 3x5 bitmap font and the HUD painters used by the Python edition.

The HUD is drawn straight into the renderer's RGB buffer, so the Python edition looks the same
whether it runs inside Tkinter or headless (see `python/pixeled.py --render`).
"""

from .blocks import HOTBAR, block, name_of

GLYPHS = {
    "A": ("010", "101", "111", "101", "101"), "B": ("110", "101", "110", "101", "110"),
    "C": ("011", "100", "100", "100", "011"), "D": ("110", "101", "101", "101", "110"),
    "E": ("111", "100", "110", "100", "111"), "F": ("111", "100", "110", "100", "100"),
    "G": ("011", "100", "101", "101", "011"), "H": ("101", "101", "111", "101", "101"),
    "I": ("111", "010", "010", "010", "111"), "J": ("001", "001", "001", "101", "010"),
    "K": ("101", "101", "110", "101", "101"), "L": ("100", "100", "100", "100", "111"),
    "M": ("101", "111", "111", "101", "101"), "N": ("101", "111", "111", "111", "101"),
    "O": ("010", "101", "101", "101", "010"), "P": ("110", "101", "110", "100", "100"),
    "Q": ("010", "101", "101", "111", "011"), "R": ("110", "101", "110", "101", "101"),
    "S": ("011", "100", "010", "001", "110"), "T": ("111", "010", "010", "010", "010"),
    "U": ("101", "101", "101", "101", "011"), "V": ("101", "101", "101", "101", "010"),
    "W": ("101", "101", "111", "111", "101"), "X": ("101", "101", "010", "101", "101"),
    "Y": ("101", "101", "010", "010", "010"), "Z": ("111", "001", "010", "100", "111"),
    "0": ("111", "101", "101", "101", "111"), "1": ("010", "110", "010", "010", "111"),
    "2": ("110", "001", "010", "100", "111"), "3": ("111", "001", "011", "001", "111"),
    "4": ("101", "101", "111", "001", "001"), "5": ("111", "100", "111", "001", "111"),
    "6": ("111", "100", "111", "101", "111"), "7": ("111", "001", "001", "010", "010"),
    "8": ("111", "101", "111", "101", "111"), "9": ("111", "101", "111", "001", "111"),
    " ": ("000", "000", "000", "000", "000"), ".": ("000", "000", "000", "000", "010"),
    ",": ("000", "000", "000", "010", "100"), ":": ("000", "010", "000", "010", "000"),
    "-": ("000", "000", "111", "000", "000"), "+": ("000", "010", "111", "010", "000"),
    "/": ("001", "001", "010", "100", "100"), "%": ("101", "001", "010", "100", "101"),
    "!": ("010", "010", "010", "000", "010"), "?": ("110", "001", "010", "000", "010"),
    "#": ("101", "111", "101", "111", "101"), "*": ("101", "010", "111", "010", "101"),
    "(": ("001", "010", "010", "010", "001"), ")": ("100", "010", "010", "010", "100"),
    "=": ("000", "111", "000", "111", "000"), "'": ("010", "010", "000", "000", "000"),
    "<": ("001", "010", "100", "010", "001"), ">": ("100", "010", "001", "010", "100"),
}

WHITE = (255, 255, 255)
SHADOW = (12, 14, 20)
PANEL = (18, 22, 30)
PANEL_LIGHT = (34, 40, 52)
TEXT = (226, 232, 240)
ACCENT = (120, 200, 255)


class Hud:
    """Draws panels, text, the hotbar and notifications onto a renderer."""

    def __init__(self, renderer):
        self.renderer = renderer
        self.messages = []          # (text, seconds_left)
        self.help_visible = False

    # ------------------------------------------------------------------ text

    def text(self, x, y, message, colour=TEXT, scale=1, shadow=True):
        """Draw a string with the 3x5 font; returns its width in pixels."""
        cursor = x
        for character in message.upper():
            glyph = GLYPHS.get(character, GLYPHS["?"])
            for row, bits in enumerate(glyph):
                for column, bit in enumerate(bits):
                    if bit == "1":
                        px = cursor + column * scale
                        py = y + row * scale
                        if shadow:
                            self.rect(px, py + scale, scale, scale, SHADOW)
                        self.rect(px, py, scale, scale, colour)
            cursor += 4 * scale
        return cursor - x

    def text_width(self, message, scale=1):
        return len(message) * 4 * scale - scale

    def centred(self, y, message, colour=TEXT, scale=1):
        width = self.text_width(message, scale)
        return self.text((self.renderer.width - width) // 2, y, message, colour, scale)

    # ------------------------------------------------------------------ shapes

    def rect(self, x, y, width, height, colour):
        renderer = self.renderer
        x0 = max(0, int(x))
        y0 = max(0, int(y))
        x1 = min(renderer.width, int(x + width))
        y1 = min(renderer.height, int(y + height))
        if x0 >= x1 or y0 >= y1:
            return
        red, green, blue = colour
        buffer = renderer.buffer
        for row in range(y0, y1):
            index = (row * renderer.width + x0) * 3
            for _ in range(x0, x1):
                buffer[index] = red
                buffer[index + 1] = green
                buffer[index + 2] = blue
                index += 3

    def panel(self, x, y, width, height):
        self.rect(x, y, width, height, PANEL)
        self.rect(x, y, width, 1, PANEL_LIGHT)
        self.rect(x, y + height - 1, width, 1, PANEL_LIGHT)
        self.rect(x, y, 1, height, PANEL_LIGHT)
        self.rect(x + width - 1, y, 1, height, PANEL_LIGHT)

    # ------------------------------------------------------------------ widgets

    def hotbar(self, selected, blocks=HOTBAR):
        renderer = self.renderer
        scale = 2 if renderer.width >= 260 else 1
        slot = 14 * scale
        gap = 2 * scale
        total = len(blocks) * slot + (len(blocks) - 1) * gap
        left = (renderer.width - total) // 2
        top = renderer.height - slot - 3 * scale
        for index, block_id in enumerate(blocks):
            x = left + index * (slot + gap)
            colour = block(block_id)[1]
            if index == selected:
                self.rect(x - scale, top - scale, slot + 2 * scale, slot + 2 * scale, WHITE)
            self.rect(x, top, slot, slot, PANEL)
            self.rect(x + scale, top + scale, slot - 2 * scale, slot - 2 * scale, colour)
            self.text(x + 2 * scale, top + slot - 6 * scale, str(index + 1), WHITE, scale)
        return left, top

    def stats(self, seed, position, biome, fps, flying):
        """Top-left status: seed, coordinates, biome, frame rate and flight mode."""
        message = "SEED %d  X %d Y %d Z %d" % (seed, position[0], position[1], position[2])
        second = "%s  %.0f FPS%s" % (biome, fps, "  FLYING" if flying else "")
        width = max(self.text_width(message), self.text_width(second)) + 6
        self.panel(3, 3, width, 16)
        self.text(6, 6, message, ACCENT)
        self.text(6, 12, second, TEXT)

    def selected_name(self, selected, blocks=HOTBAR):
        label = name_of(blocks[selected])
        width = self.text_width(label) + 6
        self.panel((self.renderer.width - width) // 2, self.renderer.height - 30, width, 9)
        self.centred(self.renderer.height - 28, label, WHITE)

    def notify(self, message):
        self.messages.append([message, 3.4])

    def update(self, dt):
        for entry in self.messages:
            entry[1] -= dt
        self.messages = [entry for entry in self.messages if entry[1] > 0]

    def toasts(self):
        for index, (message, life) in enumerate(reversed(self.messages[-4:])):
            y = 24 + index * 11
            width = self.text_width(message) + 8
            self.panel((self.renderer.width - width) // 2, y, width, 11)
            self.centred(y + 3, message, WHITE)

    def help(self):
        """Overlay listing the controls (H toggles it)."""
        renderer = self.renderer
        lines = (
            "CONTROLS",
            "WASD MOVE   SPACE JUMP   SHIFT SPRINT",
            "F FLY   SPACE/SHIFT UP AND DOWN",
            "LEFT CLICK MINE   RIGHT CLICK PLACE",
            "1-9 OR WHEEL PICK BLOCK   MIDDLE PICK",
            "MOUSE DRAG LOOK   ARROWS LOOK TOO",
            "N NEW WORLD   T TIME   H HELP   ESC QUIT",
        )
        width = max(self.text_width(line) for line in lines) + 12
        height = len(lines) * 8 + 10
        left = (renderer.width - width) // 2
        top = max(8, (renderer.height - height) // 2 - 10)
        self.panel(left, top, width, height)
        for index, line in enumerate(lines):
            colour = ACCENT if index == 0 else TEXT
            self.centred(top + 6 + index * 8, line, colour)

    def minimap(self, world, player, radius=18, size=44):
        """A small top-down map of the surrounding terrain in the top-right corner."""
        renderer = self.renderer
        if renderer.width < 180:
            return
        left = renderer.width - size - 4
        top = 4
        self.rect(left - 1, top - 1, size + 2, size + 2, PANEL_LIGHT)
        step = (radius * 2) / size
        for row in range(size):
            world_z = int(player.z - radius + row * step)
            if world_z < 0 or world_z >= len(world.ground_top[0]):
                continue
            for column in range(size):
                world_x = int(player.x - radius + column * step)
                if world_x < 0 or world_x >= len(world.ground_top):
                    continue
                surface, block_id, liquid = world.surface(world_x, world_z)
                if surface < 0:
                    colour = (16, 24, 36)
                elif liquid:
                    colour = (60, 110, 190)
                else:
                    colour = block(block_id)[1]
                self.rect(left + column, top + row, 1, 1, colour)
        centre = size // 2
        self.rect(left + centre, top + centre - 1, 1, 3, WHITE)
        self.rect(left + centre - 1, top + centre, 3, 1, WHITE)

    def crosshair(self):
        renderer = self.renderer
        centre_x, centre_y = renderer.width // 2, renderer.height // 2
        for offset in range(3, 8):
            for dx, dy in ((offset, 0), (-offset, 0), (0, offset), (0, -offset)):
                renderer.pixel(centre_x + dx, centre_y + dy, WHITE)

    def highlight_note(self, hit):
        """Small tag above the crosshair naming the block being aimed at."""
        if hit is None:
            return
        name = name_of(hit["id"])
        if name == "Air":
            return
        width = self.text_width(name) + 6
        x = (self.renderer.width - width) // 2
        y = self.renderer.height // 2 - 16
        self.panel(x, y, width, 9)
        self.text(x + 3, y + 2, name, WHITE)
