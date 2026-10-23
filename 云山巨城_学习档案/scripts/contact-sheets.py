from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / 'images'
FONT = 'C:/Windows/Fonts/msyh.ttc'

def sheet(filename, rows, columns, width=640):
    image_height = round(width * 900 / 1440)
    title_height = 46
    canvas = Image.new('RGB', (columns * width, len(rows) // columns * (image_height + title_height)), '#ede8dc')
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(FONT, 22)
    for index, (name, label) in enumerate(rows):
        x = index % columns * width
        y = index // columns * (image_height + title_height)
        image = Image.open(IMAGES / name).convert('RGB').resize((width, image_height), Image.Resampling.LANCZOS)
        canvas.paste(image, (x, y))
        draw.text((x + 16, y + image_height + 9), label, font=font, fill='#263b35')
    canvas.save(IMAGES / filename, quality=92)

sheet('18-style-overview.jpg', [
    ('01-panorama-afternoon.jpg', '全景：山水骨架与城池层级'),
    ('06-falls-afternoon.jpg', '地标：金瓦楼阁与瀑布'),
    ('07-street-afternoon.jpg', '街区：白墙黛瓦与沿路生成'),
    ('13-street-night.jpg', '夜景：冷色环境与暖色灯火'),
], 2)
sheet('19-time-comparison.jpg', [
    ('02-panorama-morning.jpg', '06:48 · 清晨'),
    ('03-panorama-noon.jpg', '12:00 · 正午'),
    ('04-panorama-dusk.jpg', '18:48 · 黄昏'),
    ('05-panorama-night.jpg', '21:30 · 夜晚'),
], 2)
sheet('20-atmos-comparison.jpg', [
    ('06-falls-afternoon.jpg', '原始效果 · 16:18'),
    ('14-falls-atmos-off.jpg', '关闭云块 / 云海平面 / 水雾粒子'),
], 2)
print('Created 3 contact sheets; original captures preserved.')
