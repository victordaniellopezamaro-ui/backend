const zlib = require('zlib');

class DataStream {
  constructor(buffer, byteOffset = 0) {
    this.buffer = buffer;
    this.byteOffset = byteOffset;
    this.position = 0;
    this.byteLength = buffer.length;
  }

  seek(position) {
    this.position = Math.max(0, Math.min(this.byteLength, position));
  }

  isEof() {
    return this.position >= this.byteLength;
  }

  readInt8() {
    const value = this.buffer.readInt8(this.byteOffset + this.position);
    this.position += 1;
    return value;
  }

  readUInt8() {
    const value = this.buffer.readUInt8(this.byteOffset + this.position);
    this.position += 1;
    return value;
  }

  readInt16() {
    const value = this.buffer.readInt16BE(this.byteOffset + this.position);
    this.position += 2;
    return value;
  }

  readUInt16() {
    const value = this.buffer.readUInt16BE(this.byteOffset + this.position);
    this.position += 2;
    return value;
  }

  readInt32() {
    const value = this.buffer.readInt32BE(this.byteOffset + this.position);
    this.position += 4;
    return value;
  }

  readInt64() {
    const value = this.buffer.readBigInt64BE(this.byteOffset + this.position);
    this.position += 8;
    return Number(value);
  }

  readFloat32() {
    const value = this.buffer.readFloatBE(this.byteOffset + this.position);
    this.position += 4;
    return value;
  }

  readFloat64() {
    const value = this.buffer.readDoubleBE(this.byteOffset + this.position);
    this.position += 8;
    return value;
  }

  readUtf8String(length) {
    const end = this.position + length;
    const stringBytes = this.buffer.slice(this.byteOffset + this.position, this.byteOffset + end);
    this.position = end;
    try {
      return stringBytes.toString('utf8');
    } catch (e) {
      console.error(`Error decoding UTF-8 string: ${e.message}`);
      return stringBytes.toString('hex');
    }
  }

  readByteArray(length) {
    const end = this.position + length;
    const byteArray = this.buffer.slice(this.byteOffset + this.position, this.byteOffset + end);
    this.position = end;
    return Array.from(byteArray);
  }
}

const SFS_DATA_TYPES = {
  0x00: 'NULL',
  0x01: 'BOOL',
  0x02: 'BYTE',
  0x03: 'SHORT',
  0x04: 'INT',
  0x05: 'LONG',
  0x06: 'FLOAT',
  0x07: 'DOUBLE',
  0x08: 'UTF_STRING',
  0x09: 'BOOL_ARRAY',
  0x0A: 'BYTE_ARRAY',
  0x0B: 'SHORT_ARRAY',
  0x0C: 'INT_ARRAY',
  0x0D: 'LONG_ARRAY',
  0x0E: 'FLOAT_ARRAY',
  0x0F: 'DOUBLE_ARRAY',
  0x10: 'UTF_STRING_ARRAY',
  0x11: 'SFS_ARRAY',
  0x12: 'SFS_OBJECT',
};

function decodeSfsObject(ds) {
  const result = {};
  const numElements = ds.readUInt16();

  for (let i = 0; i < numElements; i++) {
    const keyLength = ds.readUInt16();
    const key = ds.readUtf8String(keyLength);
    const valueType = ds.readUInt8();
    const value = decodeValue(ds, valueType);
    result[key] = value;
  }
  return result;
}

function decodeSfsArray(ds) {
  const result = [];
  const numElements = ds.readUInt16();

  for (let i = 0; i < numElements; i++) {
    const valueType = ds.readUInt8();
    const value = decodeValue(ds, valueType);
    result.push(value);
  }
  return result;
}

function decodeValue(ds, valueType) {
  switch (valueType) {
    case 0x00: return null;
    case 0x01: return !!ds.readUInt8();
    case 0x02: return ds.readInt8();
    case 0x03: return ds.readInt16();
    case 0x04: return ds.readInt32();
    case 0x05: return ds.readInt64();
    case 0x06: return ds.readFloat32();
    case 0x07: return ds.readFloat64();
    case 0x08: {
      const strLength = ds.readUInt16();
      return ds.readUtf8String(strLength);
    }
    case 0x09: {
      const boolLength = ds.readUInt16();
      return Array.from({ length: boolLength }, () => !!ds.readUInt8());
    }
    case 0x0A: {
      const byteLength = ds.readUInt16();
      return ds.readByteArray(byteLength);
    }
    case 0x0B: {
      const shortLength = ds.readUInt16();
      return Array.from({ length: shortLength }, () => ds.readInt16());
    }
    case 0x0C: {
      const intLength = ds.readUInt16();
      return Array.from({ length: intLength }, () => ds.readInt32());
    }
    case 0x0D: {
      const longLength = ds.readUInt16();
      return Array.from({ length: longLength }, () => ds.readInt64());
    }
    case 0x0E: {
      const floatLength = ds.readUInt16();
      return Array.from({ length: floatLength }, () => ds.readFloat32());
    }
    case 0x0F: {
      const doubleLength = ds.readUInt16();
      return Array.from({ length: doubleLength }, () => ds.readFloat64());
    }
    case 0x10: {
      const stringLength = ds.readUInt16();
      return Array.from({ length: stringLength }, () => {
        const len = ds.readUInt16();
        return ds.readUtf8String(len);
      });
    }
    case 0x11: return decodeSfsArray(ds);
    case 0x12: return decodeSfsObject(ds);
    default: throw new Error(`Unsupported data type: 0x${valueType.toString(16)}`);
  }
}

function decodeMessage(binaryData) {
  const ds = new DataStream(binaryData);
  const header = ds.readUInt8();

  if ((header & 0x80) !== 0x80) {
    console.error('Invalid header. Expected binary message (bit 7 = 1).');
    return null;
  }

  const messageLength = ds.readUInt16();
  let bodyData = binaryData.slice(ds.position);
  let decompressedData = bodyData;

  if (bodyData.length > 1 && bodyData.readUInt8(0) === 0x78 && bodyData.readUInt8(1) === 0x9c) {
    try {
      decompressedData = zlib.inflateSync(bodyData);
    } catch (e) {
      console.error('Error decompressing data with zlib:', e.message);
      return null;
    }
  }

  const bodyDs = new DataStream(decompressedData);
  const dataType = bodyDs.readUInt8();

  try {
    if (dataType === 0x12) {
      return decodeSfsObject(bodyDs);
    } else if (dataType === 0x11) {
      return decodeSfsArray(bodyDs);
    }
    console.error(`Unsupported root data type: 0x${dataType.toString(16)}`);
    return null;
  } catch (e) {
    console.error('Error decoding body:', e.message);
    return null;
  }
}

module.exports = { DataStream, decodeSfsObject, decodeSfsArray, decodeValue, decodeMessage };