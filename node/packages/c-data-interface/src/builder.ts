import { Vector, makeVector, Int32, Int64, Float64, Utf8, Data, Struct, Field } from 'apache-arrow';
import { NativeBufferInfo } from './types';

export class ArrowVectorBuilder {
    public build(info: NativeBufferInfo): Vector {
        switch (info.format) {
            case 'i': return this.buildInt32(info);
            case 'l': return this.buildInt64(info);
            case 'g': return this.buildFloat64(info);
            case 'u': return this.buildUtf8(info);
            case '+s': return this.buildStruct(info);
            default:
                throw new Error(`Builder: Unsupported format ${info.format}`);
        }
    }

    private buildStruct(info: NativeBufferInfo): Vector<Struct> {
        const validity = info.buffers[0] ? new Uint8Array(info.buffers[0]) : null;
        
        // Recursively build child vectors
        const childrenVectors = info.children?.map(childInfo => this.build(childInfo)) || [];
        
        // Get child Data objects
        const childrenData = childrenVectors.map(v => v.data[0]);
        
        // Construct Fields (needed for Struct Type)
        // Since we don't have names yet, we'll use index or fieldName from extractor
        const fields = childrenVectors.map((v, i) => new Field(info.children![i].fieldName || String(i), v.type, true));
        const type = new Struct(fields);
        
        // For Structs, the 'buffers' argument to Data should only contain the validity bitmap.
        // The child arrays are stored in the 'children' property of the Data object.
        const vectorData = new Data(type, 0, info.length, info.nullCount, [info.nullCount === 0 ? null : validity]);
        (vectorData as any).children = childrenData;
        
        return makeVector(vectorData);
    }

    private buildInt32(info: NativeBufferInfo): Vector<Int32> {
        const validity = info.buffers[0] ? new Uint8Array(info.buffers[0]) : null;
        const data = new Int32Array(info.buffers[1]);
        const vectorData = new Data(new Int32(), 0, info.length, info.nullCount, [info.nullCount === 0 ? null : validity, data]);
        return makeVector(vectorData);
    }

    private buildInt64(info: NativeBufferInfo): Vector<Int64> {
        const validity = info.buffers[0] ? new Uint8Array(info.buffers[0]) : null;
        const data = new BigInt64Array(info.buffers[1]);
        const vectorData = new Data(new Int64(), 0, info.length, info.nullCount, [info.nullCount === 0 ? null : validity, data]);
        return makeVector(vectorData);
    }

    private buildFloat64(info: NativeBufferInfo): Vector<Float64> {
        const validity = info.buffers[0] ? new Uint8Array(info.buffers[0]) : null;
        const data = new Float64Array(info.buffers[1]);
        const vectorData = new Data(new Float64(), 0, info.length, info.nullCount, [info.nullCount === 0 ? null : validity, data]);
        return makeVector(vectorData);
    }

    private buildUtf8(info: NativeBufferInfo): Vector<Utf8> {
        const validity = info.buffers[0] ? new Uint8Array(info.buffers[0]) : null;
        const offsets = new Int32Array(info.buffers[1]);
        const values = new Uint8Array(info.buffers[2]);

        // Utf8 Data structure: [validity, offsets, values]
        // Cast to any to bypass strict type checking on the buffers array for Utf8 construction
        const vectorData = new Data(new Utf8(), 0, info.length, info.nullCount, [info.nullCount === 0 ? null : validity, offsets, values] as any);
        
        // Workaround: Manually assign properties because the Data constructor might not populate them correctly for Utf8 from raw buffers
        // @ts-ignore
        vectorData.valueOffsets = offsets;
        // @ts-ignore
        vectorData.values = values;
        
        return makeVector(vectorData);
    }
}