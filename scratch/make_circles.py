from PIL import Image, ImageDraw

def make_circle(img_path):
    img = Image.open(img_path).convert("RGBA")
    size = img.size
    
    # Create mask
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size[0], size[1]), fill=255)
    
    # Apply mask
    result = Image.new("RGBA", size, (0, 0, 0, 0))
    result.paste(img, (0, 0), mask=mask)
    result.save(img_path, "PNG")
    print(f"Circularized {img_path}")

make_circle("assets/codeforces.png")
make_circle("assets/atcoder.png")
