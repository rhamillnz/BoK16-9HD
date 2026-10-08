import { readFileSync } from 'fs';
import { parseBook } from '../src/formats/book.ts';
import { ResourceArchive } from '../src/formats/archive.ts';

const rmf = readFileSync('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Betrayal at Krondor\\KRONDOR.RMF');
const data = readFileSync('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Betrayal at Krondor\\KRONDOR.001');

const archive = new ResourceArchive(new Uint8Array(rmf), new Uint8Array(data));
const c11 = archive.get('C11.BOK');
const book = parseBook(c11);
console.log("Page 0:");
const p = book.pages[0];
console.log(`x: ${p.x}, y: ${p.y}, width: ${p.width}, height: ${p.height}`);
console.log("Reserved:", p.reservedAreas);
