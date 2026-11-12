"""Bake the globe's land dots from Natural Earth land outlines.

    python tools/bake_land_dots.py path/to/land-110m.json dist/assets/geo/land-dots.json

The input is world-atlas@2 land-110m.json (TopoJSON, Natural Earth, public
domain). The output is a flat list [lat, lon, lat, lon, ...] of points on land,
spaced evenly over the sphere, so the browser needs no map library.
"""

import json
import math
import sys


def decode(topology):
    scale, translate = topology['transform']['scale'], topology['transform']['translate']
    arcs = []
    for arc in topology['arcs']:
        x = y = 0
        points = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            points.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
        arcs.append(points)

    def ring(indexes):
        out = []
        for index in indexes:
            points = arcs[index] if index >= 0 else list(reversed(arcs[~index]))
            out.extend(points[1:] if out else points)
        return out

    polygons = []
    for geometry in topology['objects']['land']['geometries']:
        groups = geometry['arcs'] if geometry['type'] == 'MultiPolygon' else [geometry['arcs']]
        for polygon in groups:
            polygons.append([ring(r) for r in polygon])
    return polygons


def inside(lon, lat, rings):
    hit = False
    for points in rings:
        for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
            if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                hit = not hit
    return hit


def main(source, target, step=1.6):
    polygons = decode(json.load(open(source, encoding='utf-8')))
    boxes = [(min(p[0] for r in poly for p in r), max(p[0] for r in poly for p in r),
              min(p[1] for r in poly for p in r), max(p[1] for r in poly for p in r), poly) for poly in polygons]
    dots = []
    lat = -60.0
    row = 0
    while lat <= 84:
        count = max(1, round(360 * math.cos(math.radians(lat)) / step))
        offset = (row % 2) * 0.5
        for i in range(count):
            lon = -180 + (i + offset) * 360 / count
            if any(x0 <= lon <= x1 and y0 <= lat <= y1 and inside(lon, lat, poly) for x0, x1, y0, y1, poly in boxes):
                dots += [round(lat, 1), round(lon, 1)]
        lat += step
        row += 1
    with open(target, 'w', encoding='utf-8') as handle:
        json.dump(dots, handle, separators=(',', ':'))
    print(f'{len(dots) // 2} land dots -> {target}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
