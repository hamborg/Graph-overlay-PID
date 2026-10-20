"""Made-up extra artifacts for the HTRK-VEN03 demo (multi-artifact features).

Writes into site/demo/:
  03_ahu_detail.png      AHU-01 detail diagram (the inside of the AHU box on the overview)
  04_catalog_p37.png     a product catalog page (EC plug fan + bag filter)
  05_point_list.csv      a BMS point list
  ahu_points.ttl         extra triples: sensors on and around the AHU, and BMS tags
  sheets.json            placements of graph instances on the made-up sheets
These are illustrations for the demo, not real project documents.
"""
import json, pathlib, sys
from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'site/demo')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
f = lambda p, s: ImageFont.truetype(p, s)
I = 'https://example.org/htrk-ven03/id/'
INK = (20, 26, 33)


def ahu_detail():
    W, H = 2400, 1500
    im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
    d.rectangle([20, 20, W - 20, H - 20], outline=INK, width=4)
    d.rectangle([W - 720, H - 170, W - 20, H - 20], outline=INK, width=3)
    d.text((W - 700, H - 155), 'HTRK-VEN03 · AHU-01 detail', fill=INK, font=f(BOLD, 34))
    d.text((W - 700, H - 105), 'Dwg V-102 · Rev B · made-up demo sheet', fill=INK, font=f(FONT, 26))
    d.text((60, 50), 'AHU-01  Air handling unit HTRK-VEN03', fill=INK, font=f(BOLD, 40))
    # unit casing
    d.rectangle([230, 300, 2150, 1180], outline=INK, width=5)
    ys, ye = 500, 1000
    d.line([60, ys, 2340, ys], fill=INK, width=6)
    d.line([60, ye, 2340, ye], fill=INK, width=6)
    a = {}
    # intake filter
    d.rectangle([390, ys - 70, 450, ys + 70], fill='white', outline=INK, width=5); d.line([390, ys + 70, 450, ys - 70], fill=INK, width=5)
    d.text((350, ys + 90), 'filter F7', fill=INK, font=f(FONT, 30)); a['AHU_HTRK-VEN03_IntakeFilter'] = (420, ys)
    # extract filter
    d.rectangle([1870, ye - 70, 1930, ye + 70], fill='white', outline=INK, width=5); d.line([1870, ye + 70, 1930, ye - 70], fill=INK, width=5)
    d.text((1830, ye + 90), 'filter M5', fill=INK, font=f(FONT, 30)); a['AHU_HTRK-VEN03_ExtractFilter'] = (1900, ye)
    # rotor
    d.ellipse([1000 - 230, 750 - 230, 1000 + 230, 750 + 230], fill='white', outline=INK, width=6)
    d.line([1000, 520, 1000, 980], fill=INK, width=3)
    d.text((930, 760), 'rotor', fill=INK, font=f(FONT, 34)); a['AHU_HTRK-VEN03_Rotor'] = (1000, 750)
    # supply fan + motor
    d.ellipse([1500 - 80, ys - 80, 1500 + 80, ys + 80], fill='white', outline=INK, width=6)
    d.polygon([(1460, ys - 50), (1560, ys), (1460, ys + 50)], outline=INK, width=5)
    d.text((1430, ys - 140), 'supply fan', fill=INK, font=f(FONT, 30)); a['AHU_HTRK-VEN03_SupplyFan'] = (1500, ys)
    d.line([1500, ys + 80, 1500, 640], fill=INK, width=4); d.ellipse([1455, 640, 1545, 730], fill='white', outline=INK, width=5)
    d.text((1484, 662), 'M', fill=INK, font=f(BOLD, 36)); a['AHU_HTRK-VEN03_SupplyFan_ECMotor'] = (1500, 685)
    # exhaust fan + motor
    d.ellipse([500 - 80, ye - 80, 500 + 80, ye + 80], fill='white', outline=INK, width=6)
    d.polygon([(540, ye - 50), (440, ye), (540, ye + 50)], outline=INK, width=5)
    d.text((420, ye - 140), 'exhaust fan', fill=INK, font=f(FONT, 30)); a['AHU_HTRK-VEN03_ExhaustFan'] = (500, ye)
    d.line([500, ye + 80, 500, 1060], fill=INK, width=4); d.ellipse([455, 1060, 545, 1150], fill='white', outline=INK, width=5)
    d.text((484, 1082), 'M', fill=INK, font=f(BOLD, 36)); a['AHU_HTRK-VEN03_ExhaustFan_ECMotor'] = (500, 1105)
    # heating coil
    d.rectangle([1830, ys - 75, 1910, ys + 75], fill='white', outline=INK, width=5)
    d.line([1840, ys + 60, 1870, ys - 60, 1900, ys + 60], fill=INK, width=4)
    d.text((1800, ys + 95), 'heating coil', fill=INK, font=f(FONT, 30)); a['AHU_HTRK-VEN03_HeatingCoil'] = (1870, ys)
    # sensors (bubbles)
    def bubble(x, y, tag, x0, y0, label):
        d.line([x0, y0, x, y], fill=INK, width=3)
        d.ellipse([x - 60, y - 60, x + 60, y + 60], fill='white', outline=INK, width=5)
        d.text((x - 30, y - 22), label, fill=INK, font=f(BOLD, 34))
        d.text((x - 70, y + 70 if y > y0 else y - 110), tag, fill=INK, font=f(MONO, 28))
    bubble(420, 230, 'VI-FS01', 420, ys - 70, 'PDS'); a['VI-FS01'] = (420, 230)
    bubble(2230, 260, 'VI-TT01', 2230, ys, 'TT'); a['VI-TT01'] = (2230, 260)
    bubble(2050, 260, 'VI-PT01', 2050, ys, 'PT'); a['VI-PT01'] = (2050, 260)
    bubble(2050, 1190, 'VU-TT01', 2050, ye, 'TT'); a['VU-TT01'] = (2050, 1190)
    # where the lines go
    for (x, y, t) in [(40, ys - 50, 'from Duct_INDT_02'), (2160, ys + 20, 'to Duct_VI_01'), (2160, ye - 50, 'from Duct_VU_02'), (40, ye + 20, 'to Duct_AFK_01')]:
        d.text((x, y), t, fill=INK, font=f(FONT, 26))
    a['AHU_HTRK-VEN03'] = (260, 330)
    im.save(OUT / '03_ahu_detail.png', optimize=True)
    return {'name': '03_ahu_detail.png', 'role': 'pid', 'title': 'AHU-01 detail', 'width': W, 'height': H, 'anchors': {I + k: {'x': v[0], 'y': v[1], 'source': 'import', 'conf': 1} for k, v in a.items()}}


def catalog():
    W, H = 1240, 1754
    im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 90], fill=(31, 95, 214))
    d.text((50, 22), 'AERO-MAKE  ·  Product catalog 2026', fill='white', font=f(BOLD, 40))
    d.text((W - 160, 30), 'p. 37', fill='white', font=f(FONT, 34))
    a = {}
    def product(y, title, sub, lines, kind):
        d.rectangle([60, y, 460, y + 330], fill=(235, 240, 250), outline=(31, 95, 214), width=4)
        if kind == 'fan':
            d.ellipse([140, y + 45, 380, y + 285], outline=INK, width=8)
            for k in range(6):
                import math
                ang = k * math.pi / 3
                d.line([260, y + 165, 260 + 110 * math.cos(ang), y + 165 + 110 * math.sin(ang)], fill=INK, width=6)
        else:
            for k in range(6):
                d.rectangle([110 + k * 52, y + 60, 140 + k * 52, y + 280], outline=INK, width=5)
        d.text((500, y), title, fill=INK, font=f(BOLD, 46))
        d.text((500, y + 64), sub, fill=(70, 80, 90), font=f(FONT, 30))
        for i, t in enumerate(lines):
            d.text((500, y + 130 + i * 44), t, fill=INK, font=f(FONT, 30))
        return (260, y + 165)
    fan = product(160, 'ECP-450', 'EC plug fan, direct drive', ['2.2 kW · 3 × 400 V', '1200 m³/h @ 400 Pa', 'IE5 EC motor, 0–10 V speed', 'Used in: HTRK-VEN03 supply + exhaust'], 'fan')
    flt = product(620, 'BF-592', 'Bag filter, 592 × 592 mm', ['ISO ePM1 55 % (F7) / ePM10 (M5)', 'Initial Δp 70 Pa · final 200 Pa', 'Used in: HTRK-VEN03 intake + extract'], 'filter')
    d.line([60, 1100, W - 60, 1100], fill=(180, 190, 200), width=3)
    d.text((60, 1130), 'Dimensions, wiring and spare parts: see pages 38–41.', fill=(70, 80, 90), font=f(FONT, 28))
    for k in ['AHU_HTRK-VEN03_SupplyFan', 'AHU_HTRK-VEN03_ExhaustFan']: a[k] = fan
    for k in ['AHU_HTRK-VEN03_IntakeFilter', 'AHU_HTRK-VEN03_ExtractFilter']: a[k] = flt
    im.save(OUT / '04_catalog_p37.png', optimize=True)
    return {'name': '04_catalog_p37.png', 'role': 'catalog', 'title': 'Catalog p. 37', 'width': W, 'height': H, 'anchors': {I + k: {'x': v[0], 'y': v[1], 'source': 'import', 'conf': 1} for k, v in a.items()}}


POINTS = """Tag;Description;Signal;Unit;Range
VI-TT01;Supply air temperature after heating coil;AI;°C;0-50
VI-PT01;Supply duct static pressure;AI;Pa;0-1000
VI-FS01;Supply filter differential pressure;AI;Pa;0-500
VU-TT01;Extract air temperature;AI;°C;0-50
VI-SF01;Supply fan speed setpoint;AO;%;0-100
VU-EF01;Exhaust fan speed setpoint;AO;%;0-100
VI-HC01;Heating coil valve position;AO;%;0-100
VI-ST01;AHU run command;DO;-;0/1
VI-AL01;Fire alarm shutdown;DI;-;0/1
"""

TTL = """@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix brick: <https://brickschema.org/schema/Brick#> .
@prefix sig: <https://example.org/htrk-ven03/signatures#> .
@prefix inst: <https://example.org/htrk-ven03/id/> .

# Made-up demo additions: sensors from the AHU-01 detail sheet and BMS tags from the point list.
inst:VI-TT01 a brick:Supply_Air_Temperature_Sensor ; rdfs:label "Supply air temperature" ; sig:tag "VI-TT01" ; brick:isPointOf inst:Duct_VI_01 .
inst:VI-PT01 a brick:Supply_Air_Static_Pressure_Sensor ; rdfs:label "Supply duct static pressure" ; sig:tag "VI-PT01" ; brick:isPointOf inst:Duct_VI_01 .
inst:VI-FS01 a brick:Filter_Differential_Pressure_Sensor ; rdfs:label "Supply filter differential pressure" ; sig:tag "VI-FS01" ; brick:isPointOf inst:AHU_HTRK-VEN03_IntakeFilter .
inst:VU-TT01 a brick:Return_Air_Temperature_Sensor ; rdfs:label "Extract air temperature" ; sig:tag "VU-TT01" ; brick:isPointOf inst:Duct_VU_02 .
inst:AHU_HTRK-VEN03_SupplyFan sig:tag "VI-SF01" .
inst:AHU_HTRK-VEN03_ExhaustFan sig:tag "VU-EF01" .
inst:AHU_HTRK-VEN03_HeatingCoil sig:tag "VI-HC01" .
"""

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    sheets = [ahu_detail(), catalog()]
    (OUT / 'sheets.json').write_text(json.dumps({'format': 'kg-overlay-sheets/1', 'sheets': sheets}, ensure_ascii=False, indent=1))
    (OUT / '05_point_list.csv').write_text(POINTS, encoding='utf-8')
    (OUT / 'ahu_points.ttl').write_text(TTL, encoding='utf-8')
    print('ok', [s['name'] for s in sheets])
