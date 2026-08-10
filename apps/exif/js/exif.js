/* === EXIF Parser - JPEG EXIF Reader === */

const EXIF_TAGS = {
  0x010f: '相机厂商',
  0x0110: '相机型号',
  0x0112: '拍摄方向',
  0x011a: 'X分辨率',
  0x011b: 'Y分辨率',
  0x0128: '分辨率单位',
  0x0131: '软件',
  0x0132: '修改时间',
  0x0213: 'YCbCr定位',
  0x8769: 'Exif IFD偏移',
  0x8825: 'GPS IFD偏移',
  0x829a: '曝光时间',
  0x829d: '光圈值',
  0x8822: '曝光程序',
  0x9000: 'Exif版本',
  0x9003: '拍摄日期',
  0x9004: '数字化日期',
  0x9101: '快门速度',
  0x9102: '光圈',
  0x9201: '快门速度(APEX)',
  0x9202: '光圈(APEX)',
  0x9203: '亮度值',
  0x9204: '曝光补偿',
  0x9205: '最大光圈',
  0x9207: '测光模式',
  0x9208: '光源',
  0x9209: '闪光灯',
  0x920a: '焦距',
  0x927c: '制造商备注',
  0x9286: '用户备注',
  0xa001: '色彩空间',
  0xa002: '图片宽度',
  0xa003: '图片高度',
  0xa005: 'Interoperability IFD',
  0xa20e: '相关图片宽度',
  0xa20f: '相关图片高度',
  // GPS tags
  0x0000: 'GPS版本',
  0x0001: '北纬/南纬',
  0x0002: '纬度',
  0x0003: '东经/西经',
  0x0004: '经度',
  0x0005: '高度参照',
  0x0006: '高度',
  0x0007: '时间戳',
  0x0010: '地标',
  0x0011: '图像方向',
  0x0012: 'GPS差分校正',
};

const TAG_TYPES = {
  0x0112: { 1:'上左', 2:'上右', 3:'下右', 4:'下左', 5:'左上', 6:'右上', 7:'右底', 8:'左底' },
  0x9207: { 1:'平均', 2:'中央重点', 3:'点测光', 4:'多点', 5:'评价', 6:'局部', 255:'其他' },
  0x9209: { 0:'未闪光', 1:'闪光', 5:'防红眼', 16:'未闪光', 24:'自动未闪光', 25:'自动闪光', 29:'自动防红眼' },
  0xa001: { 1:'sRGB', 2:'Adobe RGB', 65535:'未校准' },
  0x0128: { 1:'无单位', 2:'英寸', 3:'厘米' },
  0x0001: { 'N':'北纬', 'S':'南纬' },
  0x0003: { 'E':'东经', 'W':'西经' },
};

/**
 * Parse EXIF data from a JPEG file (ArrayBuffer).
 * Returns an object with tag names as keys, or null if no EXIF found.
 */
function parseEXIF(buffer) {
  const data = new DataView(buffer);
  const result = {};

  // Check JPEG SOI marker
  if (data.getUint8(0) !== 0xFF || data.getUint8(1) !== 0xD8) {
    return null; // Not a JPEG
  }

  let offset = 2;
  while (offset < buffer.byteLength) {
    // Find next marker
    if (data.getUint8(offset) !== 0xFF) break;
    const marker = data.getUint8(offset + 1);
    
    // SOS (Start of Scan) - no more metadata after this
    if (marker === 0xDA) break;

    const length = data.getUint16(offset + 2);
    
    // APP1 - EXIF
    if (marker === 0xE1 && length >= 8) {
      // Check "Exif\0\0" header
      let exifOffset = offset + 4;
      if (data.getUint8(exifOffset) === 0x45 && // 'E'
          data.getUint8(exifOffset + 1) === 0x78 && // 'x'
          data.getUint8(exifOffset + 2) === 0x69 && // 'i'
          data.getUint8(exifOffset + 3) === 0x66 && // 'f'
          data.getUint8(exifOffset + 4) === 0x00 &&
          data.getUint8(exifOffset + 5) === 0x00) {
        
        exifOffset += 6;
        parseTIFF(data, exifOffset, result);
      }
    }

    offset += 2 + length;
    if (offset >= buffer.byteLength) break;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function parseTIFF(data, offset, result) {
  // Endianness
  const endian = data.getUint16(offset);
  const little = endian === 0x4949; // 'II'
  const big = endian === 0x4D4D;    // 'MM'
  if (!little && !big) return;

  const get16 = (off) => little ? data.getUint16(off, true) : data.getUint16(off);
  const get32 = (off) => little ? data.getUint32(off, true) : data.getUint32(off);

  // Check TIFF magic number (0x002A)
  if (get16(offset + 2) !== 0x002A) return;

  const ifdOffset = get32(offset + 4);
  parseIFD(data, offset + ifdOffset, result, get16, get32, offset);
}

function parseIFD(data, ifdStart, result, get16, get32, tiffBase) {
  const entryCount = get16(ifdStart);
  
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    const tag = get16(entryOffset);
    const type = get16(entryOffset + 2);
    const count = get32(entryOffset + 4);
    const valueOffset = entryOffset + 8;

    const tagName = EXIF_TAGS[tag];
    if (!tagName) continue;

    let value;
    const size = typeSize(type) * count;

    if (size <= 4) {
      value = readValue(data, valueOffset, type, count, get16, get32);
    } else {
      const dataOffset = tiffBase + get32(valueOffset);
      value = readValue(data, dataOffset, type, count, get16, get32);
    }

    if (value !== null && value !== undefined) {
      // Apply type-specific formatting
      const typeMap = TAG_TYPES[tag];
      if (typeMap && typeMap[value] !== undefined) {
        value = typeMap[value];
      }
      
      // Format rational numbers
      if (tag === 0x920a) { // Focal length
        if (typeof value === 'number') value = value.toFixed(1) + ' mm';
      }
      if (tag === 0x829a) { // Exposure time
        if (value > 0 && value < 1) {
          value = '1/' + Math.round(1 / value);
        } else {
          value = value + ' sec';
        }
      }
      if (tag === 0x829d) { // F-number
        if (typeof value === 'number') value = 'f/' + value.toFixed(1);
      }

      result[tagName] = String(value);
    }
  }

  // Check for Exif IFD pointer
  const exifIFDPtr = result['Exif IFD偏移'];
  if (exifIFDPtr) {
    const subIfd = tiffBase + parseInt(exifIFDPtr);
    parseIFD(data, subIfd, result, get16, get32, tiffBase);
  }

  // GPS
  const gpsPtr = result['GPS IFD偏移'];
  if (gpsPtr) {
    const gpsIfd = tiffBase + parseInt(gpsPtr);
    parseIFD(data, gpsIfd, result, get16, get32, tiffBase);
  }

  // Clean up internal pointers
  delete result['Exif IFD偏移'];
  delete result['GPS IFD偏移'];
}

function typeSize(type) {
  const sizes = { 1:1, 2:1, 3:2, 4:4, 5:8, 7:1, 9:4, 10:8 };
  return sizes[type] || 1;
}

function readValue(data, offset, type, count, get16, get32) {
  switch (type) {
    case 1: // BYTE
    case 7: // UNDEFINED
      return data.getUint8(offset);
    case 2: // ASCII
      return readString(data, offset, count);
    case 3: // SHORT
      return get16(offset);
    case 4: // LONG
      return get32(offset);
    case 5: { // RATIONAL (two LONGs: numerator, denominator)
      const num = get32(offset);
      const den = get32(offset + 4);
      return den !== 0 ? num / den : 0;
    }
    case 9: // SLONG
      return data.getInt32(offset, true);
    case 10: { // SRATIONAL
      const num = data.getInt32(offset, true);
      const den = data.getInt32(offset + 4, true);
      return den !== 0 ? num / den : 0;
    }
    default:
      return null;
  }
}

function readString(data, offset, count) {
  const bytes = [];
  for (let i = 0; i < count && data.getUint8(offset + i) !== 0; i++) {
    bytes.push(data.getUint8(offset + i));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
