import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

export function createZip(files) {
  const locals = []
  const central = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const data = deflateRawSync(file.data)
    const crc = crc32(file.data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, data)
    const item = Buffer.alloc(46 + name.length)
    item.writeUInt32LE(0x02014b50, 0)
    item.writeUInt16LE(20, 4)
    item.writeUInt16LE(20, 6)
    item.writeUInt16LE(8, 10)
    item.writeUInt32LE(crc, 16)
    item.writeUInt32LE(data.length, 20)
    item.writeUInt32LE(file.data.length, 24)
    item.writeUInt16LE(name.length, 28)
    item.writeUInt32LE(offset, 42)
    name.copy(item, 46)
    central.push(item)
    offset += local.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

export function readZip(buffer) {
  const files = []
  let offset = 0
  while (offset + 30 < buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature === 0x02014b50 || signature === 0x06054b50) break
    if (signature !== 0x04034b50) break
    const method = buffer.readUInt16LE(offset + 8)
    const compressed = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extra = buffer.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLength + extra
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const payload = buffer.subarray(start, start + compressed)
    const data = method === 0 ? payload : inflateRawSync(payload)
    if (!name.endsWith('/')) files.push({ name, data })
    offset = start + compressed
  }
  return files
}
