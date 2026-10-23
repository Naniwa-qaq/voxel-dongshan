"""Restore the byte-identical large source snapshot; Python standard library only."""
from pathlib import Path
import gzip
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / '东山镇_数据' / 'overture'
MANIFEST = FOLDER / 'large-source-backup.json'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    info = json.loads(MANIFEST.read_text(encoding='utf-8'))
    target = FOLDER / info['source']
    archive = FOLDER / info['archive']
    for path in (target, archive):
        if path.resolve().parent != FOLDER.resolve():
            raise ValueError('Backup paths must remain inside the Overture source folder')
    if target.exists():
        if digest(target) != info['sourceSha256']:
            raise RuntimeError('Existing source has a different checksum; no file overwritten')
        print('Source already present and SHA-256 verified:', target.relative_to(ROOT))
        return
    if digest(archive) != info['archiveSha256']:
        raise RuntimeError('Compressed backup checksum mismatch')
    temporary = target.with_suffix(target.suffix + '.restoring')
    h, count = hashlib.sha256(), 0
    with gzip.open(archive, 'rb') as source, temporary.open('xb') as output:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            count += len(chunk)
            if count > info['sourceBytes']:
                raise RuntimeError('Decoded file exceeds its declared size')
            h.update(chunk)
            output.write(chunk)
    if count != info['sourceBytes'] or h.hexdigest() != info['sourceSha256']:
        raise RuntimeError('Decoded source does not match its original checksum')
    if target.exists():
        raise RuntimeError('Destination appeared during restoration; no overwrite performed')
    temporary.rename(target)
    print('Restored and SHA-256 verified:', target.relative_to(ROOT))


if __name__ == '__main__':
    main()
