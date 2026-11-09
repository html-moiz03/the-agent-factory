"""Agent Factory city, rebuilt in Blender.

Run with Blender:   blender --background --python build_city.py
Or with the bpy module:   python build_city.py

Layout, colours and robot proportions are taken from lib/city.js (the three.js version).
The web scene is y-up with z toward the viewer; Blender is z-up. Mapping: web (x, y, z) -> blender (x, -z, y).
"""
import math
import os
import random
import sys

import bpy  # must come first: it registers bmesh and mathutils
import bmesh
import numpy as np
from mathutils import Matrix, Vector

OUT_DIR = os.environ.get("CITY_OUT", os.path.dirname(os.path.abspath(__file__)))
SAMPLES = int(os.environ.get("CITY_SAMPLES", "48"))
RES_X = int(os.environ.get("CITY_RES_X", "1600"))
RENDER = os.environ.get("CITY_RENDER", "1") == "1"
random.seed(7)

# ---------------------------------------------------------------- helpers
def srgb(hexcol):
    """'#RRGGBB' or int -> linear RGBA for Blender."""
    if isinstance(hexcol, str):
        hexcol = int(hexcol.lstrip("#"), 16)
    out = []
    for shift in (16, 8, 0):
        c = ((hexcol >> shift) & 255) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def P(x, y, z):
    return Vector((x, -z, y))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection


def link(obj, parent=None):
    coll.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def mat_diffuse(name, color, rough=0.7, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(color)
    b.inputs["Roughness"].default_value = rough
    if emit is not None:
        b.inputs["Emission Color"].default_value = srgb(emit)
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


def mat_glow(name, color, strength=4.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = srgb(color)
    e.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs["Emission"], out.inputs["Surface"])
    return m


def box_mesh(name, w, h, d):
    """Box with web dimensions (w along x, h up, d along web z). Centered on its origin."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((w, d, h, 1.0)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def box(name, w, h, d, center, mat, parent=None):
    o = bpy.data.objects.new(name, box_mesh(name, w, h, d))
    o.location = P(*center)
    o.data.materials.append(mat)
    return link(o, parent)


class Batch:
    """Many cubes in one mesh object (keeps the scene light)."""

    def __init__(self, name, mat):
        self.name, self.mat = name, mat
        self.bm = bmesh.new()

    def add(self, w, h, d, center):
        c = P(*center)
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=Matrix.Translation(c) @ Matrix.Diagonal((w, d, h, 1.0)))

    def done(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        o = bpy.data.objects.new(self.name, me)
        o.data.materials.append(self.mat)
        return link(o)


def cylinder(name, r1, r2, h, center, mat, parent=None, verts=24, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r1, radius2=r2, depth=h)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.location = P(*center)
    if rot:
        o.rotation_euler = rot
    o.data.materials.append(mat)
    return link(o, parent)


def sphere(name, r, center, mat, parent=None, seg=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.location = P(*center)
    o.data.materials.append(mat)
    return link(o, parent)


def smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True


# ---------------------------------------------------------------- data (from lib/agents.js and lib/city.js)
AGENTS = [
    dict(id="friday", name="FRIDAY", station="Research Lab", color="#4CC9F0", pad=(-10, -5), bld=(-10, -9.8), row="A", h=5, kind="research"),
    dict(id="edith", name="EDITH", station="UI/UX Studio", color="#F78FB3", pad=(0, -5), bld=(0, -9.8), row="A", h=6, kind="ui"),
    dict(id="jarvis", name="JARVIS", station="Backend Forge", color="#A78BFA", pad=(10, -5), bld=(10, -9.8), row="A", h=6.5, kind="backend"),
    dict(id="dume", name="DUM-E", station="Testing Bay", color="#5FD3A0", pad=(10, 5), bld=(10, 9.8), row="B", h=5, kind="testing"),
    dict(id="ultron", name="ULTRON", station="Security Gate", color="#FF7B72", pad=(0, 5), bld=(0, 9.8), row="B", h=5.5, kind="security"),
    dict(id="vision", name="VISION", station="Judge's Court", color="#FFB84D", pad=(-10, 5), bld=(-10, 9.8), row="B", h=7, kind="judge"),
]

# ---------------------------------------------------------------- world, light, render
world = bpy.data.worlds.new("Night")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = srgb(0x0E1A2B)
bg.inputs["Strength"].default_value = 0.55

sun_data = bpy.data.lights.new("Moon", "SUN")
sun_data.energy = 1.6
sun_data.color = srgb(0xCFE0FF)[:3]
sun_data.angle = math.radians(3)
sun = bpy.data.objects.new("Moon", sun_data)
sun.location = P(-18, 34, 20)
# aim from (-18,34,20)-ish toward the origin
direction = Vector((0, 0, 0)) - sun.location
sun.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
link(sun)

# ---------------------------------------------------------------- ground and roads
ground_mat = mat_diffuse("Ground", 0x142238, rough=0.95)
box("Ground", 90, 0.1, 70, (0, -0.05, 0), ground_mat)

road_mat = mat_diffuse("Road", 0x0B1424, rough=0.55)
line_mat = mat_glow("RoadLine", 0x3C5A85, 1.2)
ROADS = [
    (-22, -5, 22, -5), (-22, 5, 22, 5), (-10, -5, -10, 5), (10, -5, 10, 5),
    (-22, -14.5, 22, -14.5), (-22, 14.5, 22, 14.5), (-22, -14.5, -22, 14.5), (22, -14.5, 22, 14.5),
]
dashes = Batch("RoadDashes", line_mat)
roads = Batch("Roads", road_mat)
for x1, z1, x2, z2 in ROADS:
    w = 3.2
    horiz = abs(z1 - z2) < 0.01
    length = abs(x2 - x1) if horiz else abs(z2 - z1)
    roads.add(length if horiz else w, 0.06, w if horiz else length, ((x1 + x2) / 2, 0.03, (z1 + z2) / 2))
    n = int(length // 2.2)
    for i in range(n):
        t = -length / 2 + 1.1 + i * 2.2
        if horiz:
            dashes.add(1.1, 0.02, 0.12, ((x1 + x2) / 2 + t, 0.07, z1))
        else:
            dashes.add(0.12, 0.02, 1.1, (x1, 0.07, (z1 + z2) / 2 + t))
roads.done()
dashes.done()

# ---------------------------------------------------------------- buildings
def window_image(seed):
    rnd = random.Random(seed)
    n = 64
    px = np.zeros((n, n, 4), dtype=np.float32)
    px[..., 3] = 1.0
    for gy in range(4):
        for gx in range(4):
            if rnd.random() < 0.5:
                col = (1.0, 0.85, 0.54) if rnd.random() < 0.65 else (0.56, 0.78, 1.0)
                x0, y0 = gx * 16 + 4, gy * 16 + 4
                px[y0:y0 + 9, x0:x0 + 8, :3] = col
    # write a real PNG, load it back and pack it, so the .blend is self-contained
    tmp = bpy.data.images.new(f"WindowsTmp{seed}", n, n, alpha=True)
    tmp.pixels.foreach_set(px.ravel())
    tmp.update()
    path = os.path.join(OUT_DIR, f"windows{seed}.png")
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp.filepath_raw = path
    tmp.file_format = "PNG"
    tmp.save()
    bpy.data.images.remove(tmp)
    img = bpy.data.images.load(path)
    img.name = f"Windows{seed}"
    img.colorspace_settings.name = "sRGB"
    img.pack()
    return img


WIN_IMGS = [window_image(s) for s in range(3)]


def building_mat(name, base, variant):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(base)
    b.inputs["Roughness"].default_value = 0.6
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.4, 0.4, 0.4)
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = WIN_IMGS[variant % 3]
    tx.projection = "BOX"
    tx.projection_blend = 0.0
    tx.interpolation = "Closest"
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], tx.inputs["Vector"])
    nt.links.new(tx.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 2.2
    return m


def filler(i, x, z, w, d, h):
    box(f"Filler{i}", w, h, d, (x, h / 2, z), building_mat(f"FillerMat{i}", 0x1A2E4A, i))


for i, (x, z, w, d, h) in enumerate(
    [(-17, -9.8, 5, 5, 4), (17, -9.8, 5, 5, 5), (-17, 9.8, 5, 5, 5), (17, 9.8, 5, 5, 4), (-16.5, 0, 6, 5, 3.4), (16.5, 0, 6, 5, 3.8)]
):
    filler(i, x, z, w, d, h)

metal_mat = mat_diffuse("Metal", 0xC8D4E6, rough=0.35)
dark_mat = mat_diffuse("Dark", 0x0B1424, rough=0.5)


def sign_text(text, color, parent, pos, flip):
    plane = box("SignPlate", 5.6, 1.1, 0.05, pos, mat_glow("Sign_" + text, color, 0.9), parent)
    cu = bpy.data.curves.new("SignText_" + text, "FONT")
    cu.body = text
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.size = 0.62
    cu.extrude = 0.01
    t = bpy.data.objects.new("SignText_" + text, cu)
    t.data.materials.append(mat_diffuse("SignInk", 0x0B1424, rough=0.9))
    # text lies in the XY plane facing +Z; stand it up so it faces the road
    t.rotation_euler = (math.radians(90), 0, math.radians(0 if not flip else 180))
    off = 0.06 if not flip else -0.06
    t.location = P(pos[0], pos[1], pos[2] + off)
    return link(t, parent)


for st in AGENTS:
    w, d, h = 7, 5, st["h"]
    x, z = st["bld"]
    side = 1 if st["row"] == "A" else -1
    root = bpy.data.objects.new("Station_" + st["name"], None)
    root.location = P(x, 0, z)
    link(root)
    box("Body", w, h, d, (0, h / 2, 0), building_mat("Body_" + st["name"], 0x1D3352, AGENTS.index(st)), root)
    roof = mat_diffuse("Roof_" + st["name"], 0x16263D, rough=0.6, emit=st["color"], emit_strength=0.5)
    box("Roof", w + 0.4, 0.35, d + 0.4, (0, h + 0.175, 0), roof, root)
    sign_text(st["station"], st["color"], root, (0, h - 1, side * (d / 2 + 0.03)), side < 0)
    box("Door", 1.6, 2.2, 0.1, (0, 1.1, side * (d / 2 + 0.04)), mat_glow("Door_" + st["name"], st["color"], 1.1), root)
    cylinder("Mast", 0.05, 0.05, 0.9, (0, h + 0.8, 0), metal_mat, root, verts=8)
    sphere("Beacon", 0.22, (0, h + 1.35, 0), mat_glow("Beacon_" + st["name"], st["color"], 12.0), root)
    # glow pad on the road
    ring = bpy.data.objects.new("Ring_" + st["name"], None)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=48, radius1=1.4, radius2=1.4, depth=0.02)
    me = bpy.data.meshes.new("Ring_" + st["name"])
    bm.to_mesh(me)
    bm.free()
    ring_obj = bpy.data.objects.new("Ring_" + st["name"], me)
    ring_obj.location = P(st["pad"][0], 0.09, st["pad"][1])
    ring_obj.data.materials.append(mat_glow("Ring_" + st["name"], st["color"], 2.0))
    link(ring_obj)
    ring_obj.modifiers.new("Solid", "SOLIDIFY").thickness = 0.06
    # a light so each station washes its colour onto the street
    ld = bpy.data.lights.new("PadLight_" + st["name"], "POINT")
    ld.energy = 260
    ld.color = srgb(st["color"])[:3]
    ld.shadow_soft_size = 0.5
    lo = bpy.data.objects.new("PadLight_" + st["name"], ld)
    lo.location = P(st["pad"][0], 3.2, st["pad"][1] + (1.0 if st["row"] == "A" else -1.0) * 0)
    link(lo)

# ---------------------------------------------------------------- fountain
stone = mat_diffuse("Stone", 0x1D3352, rough=0.6)
cylinder("Basin", 2.6, 2.4, 0.4, (0, 0.2, 0), stone, verts=48)
cylinder("Water", 2.1, 2.1, 0.05, (0, 0.42, 0), mat_glow("Water", 0x2E6FA8, 1.2), verts=48)
cylinder("Jet", 0.14, 0.08, 1.4, (0, 1.1, 0), mat_glow("Jet", 0x8FC7FF, 3.0), verts=12)

# ---------------------------------------------------------------- trees and lamps
trunk_mat = mat_diffuse("Trunk", 0x3B2A1E)
leaf_a = mat_diffuse("LeafA", 0x1E5A44, rough=0.9)
leaf_b = mat_diffuse("LeafB", 0x24684F, rough=0.9)
TREES = [(-5, -9.8), (5, -9.8), (-5, 9.8), (5, 9.8), (-20.5, -9.8), (20.5, -9.8), (-20.5, 9.8), (20.5, 9.8),
         (-13, 0), (13, 0), (-5, -2.8), (5, 2.8), (-20, -12), (20, 12), (-6, -12.2), (6, 12.2)]
for i, (x, z) in enumerate(TREES):
    s = 0.85 + (i % 3) * 0.12
    root = bpy.data.objects.new(f"Tree{i}", None)
    root.location = P(x, 0, z)
    root.scale = (s, s, s)
    link(root)
    cylinder("Trunk", 0.2, 0.15, 0.9, (0, 0.45, 0), trunk_mat, root, verts=8)
    cylinder("LeafLow", 1.0, 0.0, 1.8, (0, 1.7, 0), leaf_a, root, verts=8)
    cylinder("LeafTop", 0.75, 0.0, 1.4, (0, 2.6, 0), leaf_b, root, verts=8)

lamp_head = mat_glow("LampHead", 0xFFE3A0, 14.0)
pole_mat = mat_diffuse("Pole", 0x5B6F8C, rough=0.4)
for i, (x, z) in enumerate([(-5, -3.2), (5, -3.2), (-5, 3.2), (5, 3.2), (-19, -3.2), (19, -3.2), (-19, 3.2), (19, 3.2)]):
    cylinder("Pole", 0.08, 0.06, 3, (x, 1.5, z), pole_mat, verts=8)
    sphere("LampHead", 0.22, (x, 3.1, z), lamp_head)
    ld = bpy.data.lights.new(f"Lamp{i}", "POINT")
    ld.energy = 140
    ld.color = srgb(0xFFE3A0)[:3]
    ld.shadow_soft_size = 0.2
    lo = bpy.data.objects.new(f"Lamp{i}", ld)
    lo.location = P(x, 3.0, z)
    link(lo)

# ---------------------------------------------------------------- cars
car_body_cols = [0xFFB84D, 0x4CC9F0, 0xF78FB3, 0xA78BFA]
lane = [(-21.2, -13.7), (21.2, -13.7), (21.2, 13.7), (-21.2, 13.7)]
loop = [math.dist(lane[i], lane[(i + 1) % 4]) for i in range(4)]
total = sum(loop)


def lane_point(s):
    s %= total
    for i in range(4):
        if s <= loop[i]:
            a, b = lane[i], lane[(i + 1) % 4]
            t = s / loop[i]
            return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, math.atan2(b[0] - a[0], b[1] - a[1])
        s -= loop[i]
    return 0, 0, 0


for i, c in enumerate(car_body_cols):
    x, z, heading = lane_point(i * total / 4 + 6)
    car = bpy.data.objects.new(f"Car{i}", None)
    car.location = P(x, 0, z)
    # web heading is about web-y; the equivalent blender rotation about Z is the same angle
    car.rotation_euler = (0, 0, -heading + math.pi)
    link(car)
    box("Body", 0.95, 0.5, 1.9, (0, 0.45, 0), mat_diffuse(f"Car{i}", c, rough=0.35), car)
    box("Cabin", 0.8, 0.4, 1.0, (0, 0.9, -0.1), dark_mat, car)
    box("Headlights", 0.7, 0.12, 0.05, (0, 0.5, 0.96), mat_glow("Headlight", 0xFFF2C8, 10.0), car)

# ---------------------------------------------------------------- robots
def add_prop(hand, st):
    light = mat_diffuse("PropLight", 0xEAF0F8, rough=0.4)
    acc = mat_diffuse("PropAcc_" + st["id"], st["color"], rough=0.4, emit=st["color"], emit_strength=1.0)
    k = st["kind"]
    if k == "research":  # magnifier
        box("Handle", 0.07, 0.42, 0.07, (0, -0.2, 0), light, hand)
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, segments=24, radius=0.24)
        me = bpy.data.meshes.new("Lens")
        bm.to_mesh(me)
        bm.free()
        lens = bpy.data.objects.new("Lens", me)
        lens.location = P(0, -0.62, 0)
        lens.rotation_euler = (math.radians(90), 0, 0)
        lens.data.materials.append(light)
        link(lens, hand)
        wm = lens.modifiers.new("Wire", "WIREFRAME")
        wm.thickness = 0.05
        cylinder("Glass", 0.2, 0.2, 0.01, (0, -0.62, 0), mat_glow("Glass", st["color"], 1.5), hand, rot=(math.radians(90), 0, 0))
    elif k == "ui":  # pen
        box("Pen", 0.1, 0.8, 0.1, (0, -0.4, 0), light, hand)
        cylinder("Nib", 0.07, 0.0, 0.2, (0, -0.9, 0), acc, hand, verts=8, rot=(math.radians(180), 0, 0))
    elif k == "backend":  # hammer
        box("Shaft", 0.08, 0.62, 0.08, (0, -0.3, 0), light, hand)
        box("Head", 0.5, 0.24, 0.24, (0, -0.66, 0), acc, hand)
    elif k == "testing":  # clipboard
        box("Board", 0.46, 0.58, 0.05, (0, -0.35, 0.14), light, hand)
        box("Check1", 0.26, 0.07, 0.06, (0, -0.3, 0.18), acc, hand)
        box("Check2", 0.26, 0.07, 0.06, (0, -0.45, 0.18), acc, hand)
    elif k == "security":  # shield
        cylinder("Shield", 0.36, 0.36, 0.07, (0.05, -0.32, 0.2), acc, hand, verts=6, rot=(math.radians(90), 0, 0))
    else:  # gavel
        box("Handle", 0.08, 0.64, 0.08, (0, -0.3, 0), light, hand)
        cylinder("Mallet", 0.14, 0.14, 0.5, (0, -0.66, 0), acc, hand, verts=14, rot=(0, math.radians(90), 0))


def make_robot(st):
    root = bpy.data.objects.new("Robot_" + st["name"], None)
    root.location = P(st["pad"][0], 0, st["pad"][1])
    # web front is +z (toward blender -Y). Row A robots face their building, which is at web -z.
    root.rotation_euler = (0, 0, math.pi if st["row"] == "A" else 0)
    link(root)
    body = mat_diffuse("RobotBody_" + st["id"], st["color"], rough=0.45)
    eye = mat_glow("Eye", 0xFFB84D, 8.0)
    box("Torso", 0.95, 0.95, 0.6, (0, 1.2, 0), body, root)
    box("Chest", 0.5, 0.3, 0.05, (0, 1.25, 0.31), dark_mat, root)
    head = bpy.data.objects.new("Head", None)
    head.location = P(0, 2.0, 0)
    link(head, root)
    box("Skull", 1.0, 0.78, 0.82, (0, 0, 0), body, head)
    box("Face", 0.78, 0.48, 0.05, (0, 0.02, 0.42), dark_mat, head)
    box("EyeL", 0.14, 0.14, 0.05, (-0.18, 0.04, 0.46), eye, head)
    box("EyeR", 0.14, 0.14, 0.05, (0.18, 0.04, 0.46), eye, head)
    cylinder("Antenna", 0.03, 0.03, 0.35, (0, 0.55, 0), metal_mat, head, verts=8)
    sphere("Bulb", 0.1, (0, 0.78, 0), mat_glow("Bulb", 0xFFB84D, 10.0), head, seg=12)

    def limb(name, x, y, w, h, m):
        pivot = bpy.data.objects.new(name, None)
        pivot.location = P(x, y, 0)
        link(pivot, root)
        box(name + "Mesh", w, h, w, (0, -h / 2 + 0.05, 0), m, pivot)
        return pivot

    limb("ArmL", -0.64, 1.6, 0.22, 0.78, body)
    arm_r = limb("ArmR", 0.64, 1.6, 0.22, 0.78, body)
    limb("LegL", -0.24, 0.78, 0.28, 0.78, metal_mat)
    limb("LegR", 0.24, 0.78, 0.28, 0.78, metal_mat)
    # right arm raised a little so the tool reads clearly
    arm_r.rotation_euler = (math.radians(-35), 0, 0)
    hand = bpy.data.objects.new("Hand", None)
    hand.location = P(0, -0.75, 0.12)
    link(hand, arm_r)
    add_prop(hand, st)
    return root


for st in AGENTS:
    make_robot(st)

# ---------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 30
cam = bpy.data.objects.new("Cam", cam_data)
link(cam)
scene.camera = cam
target = bpy.data.objects.new("CamTarget", None)
target.location = (0, 0, 1.5)
link(target)
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"

# slow orbit so the .blend also contains a ready-made animation
FR = 240
scene.frame_start, scene.frame_end = 1, FR
scene.render.fps = 24
orbit = bpy.data.objects.new("CamOrbit", None)
link(orbit)
cam.parent = orbit
cam.location = (0, -36, 40)
orbit.rotation_euler = (0, 0, math.radians(-22))
orbit.keyframe_insert("rotation_euler", frame=1)
orbit.rotation_euler = (0, 0, math.radians(22))
orbit.keyframe_insert("rotation_euler", frame=FR)
for fc in orbit.animation_data.action.fcurves if hasattr(orbit.animation_data.action, "fcurves") else []:
    for kp in fc.keyframe_points:
        kp.interpolation = "BEZIER"

# ---------------------------------------------------------------- render settings
r = scene.render
r.engine = "CYCLES"
r.resolution_x = RES_X
r.resolution_y = int(RES_X * 9 / 16)
r.resolution_percentage = 100
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in [x.identifier for x in scene.view_settings.bl_rna.properties["look"].enum_items] else "None"
scene.view_settings.exposure = 0.3

os.makedirs(OUT_DIR, exist_ok=True)
blend_path = os.path.join(OUT_DIR, "agent_city.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print("saved", blend_path)

if RENDER:
    def shot(name, frame, cam_loc, tgt, lens):
        scene.frame_set(frame)
        cam.parent = None
        cam.location = cam_loc
        target.location = tgt
        cam_data.lens = lens
        scene.render.filepath = os.path.join(OUT_DIR, name)
        bpy.ops.render.render(write_still=True)
        print("rendered", name)

    shot("agent_city_hero.png", 1, (0, -34, 41), (0, 1, 0.5), 30)
    shot("agent_city_closeup.png", 1, (4.6, -6.5, 2.2), (0.2, -5, 2.0), 28)
    # restore the orbit rig for the saved file
    cam.parent = orbit
    cam.location = (0, -36, 40)
    target.location = (0, 0, 1.5)
    cam_data.lens = 30
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
