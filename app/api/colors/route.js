import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const colorsPath = path.join(process.cwd(), 'public', 'images', 'aesthetic-images', 'colors.json');

export async function GET() {
  try {
    const data = JSON.parse(fs.readFileSync(colorsPath, 'utf-8'));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { filename, colors, reviewed, mode } = body;

    const data = JSON.parse(fs.readFileSync(colorsPath, 'utf-8'));
    if (!data[filename]) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    if (colors) data[filename].colors = colors;
    if (reviewed !== undefined) data[filename].reviewed = reviewed;
    if (mode !== undefined) data[filename].mode = mode;

    // Atomic write
    const tmp = colorsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, colorsPath);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
