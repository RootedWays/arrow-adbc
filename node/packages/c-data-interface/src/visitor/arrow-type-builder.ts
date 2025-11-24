import { DataType, Int32, Int64, Float64, Utf8, Struct, Field, Null, Float32, Float16, Int8, Int16, Uint8, Uint16, Uint32, Uint64, Bool, Binary, LargeBinary, LargeUtf8, List, Timestamp, TimeUnit } from 'apache-arrow';
import { CSchemaVisitor } from './c-schema';
import { ArrowSchemaHandle } from '../schema';
import binding from '../index';

export class ArrowTypeBuilder extends CSchemaVisitor<DataType> {
    
    // --- Primitives ---
    visitNull(schema: ArrowSchemaHandle) { return new Null(); }
    visitBool(schema: ArrowSchemaHandle) { return new Bool(); }
    visitInt8(schema: ArrowSchemaHandle) { return new Int8(); }
    visitUint8(schema: ArrowSchemaHandle) { return new Uint8(); }
    visitInt16(schema: ArrowSchemaHandle) { return new Int16(); }
    visitUint16(schema: ArrowSchemaHandle) { return new Uint16(); }
    visitInt32(schema: ArrowSchemaHandle) { return new Int32(); }
    visitUint32(schema: ArrowSchemaHandle) { return new Uint32(); }
    visitInt64(schema: ArrowSchemaHandle) { return new Int64(); }
    visitUint64(schema: ArrowSchemaHandle) { return new Uint64(); }
    visitFloat16(schema: ArrowSchemaHandle) { return new Float16(); }
    visitFloat32(schema: ArrowSchemaHandle) { return new Float32(); }
    visitFloat64(schema: ArrowSchemaHandle) { return new Float64(); }

    // --- Binary / String ---
    visitBinary(schema: ArrowSchemaHandle) { return new Binary(); }
    visitLargeBinary(schema: ArrowSchemaHandle) { return new LargeBinary(); }
    visitUtf8(schema: ArrowSchemaHandle) { return new Utf8(); }
    visitLargeUtf8(schema: ArrowSchemaHandle) { return new LargeUtf8(); }

    // --- Temporal ---
    visitTimestamp(schema: ArrowSchemaHandle) {
        const info = binding.getSchemaInfo(schema.ptr);
        const unit = info.timeUnit as unknown as TimeUnit;
        return new Timestamp(unit, info.timezone);
    }
    
    visitDate32(schema: ArrowSchemaHandle): DataType { throw new Error("Date32 not yet implemented"); }
    visitDate64(schema: ArrowSchemaHandle): DataType { throw new Error("Date64 not yet implemented"); }
    visitTime32(schema: ArrowSchemaHandle): DataType { throw new Error("Time32 not yet implemented"); }
    visitTime64(schema: ArrowSchemaHandle): DataType { throw new Error("Time64 not yet implemented"); }
    visitDuration(schema: ArrowSchemaHandle): DataType { throw new Error("Duration not yet implemented"); }
    visitIntervalMonths(schema: ArrowSchemaHandle): DataType { throw new Error("IntervalMonths not yet implemented"); }
    visitIntervalDayTime(schema: ArrowSchemaHandle): DataType { throw new Error("IntervalDayTime not yet implemented"); }
    visitIntervalMonthDayNano(schema: ArrowSchemaHandle): DataType { throw new Error("IntervalMonthDayNano not yet implemented"); }

    // --- Nested ---
    visitStruct(schema: ArrowSchemaHandle) {
        const numChildren = binding.getSchemaChildrenCount(schema.ptr);
        const fields: Field[] = [];
        for (let i = 0; i < numChildren; i++) {
            const childPtr = binding.getSchemaChild(schema.ptr, i);
            if (!childPtr) throw new Error(`Missing child schema at index ${i}`);
            
            // Temporarily wrap without releasing ownership (parent owns it)
            const childSchema = new ArrowSchemaHandle(childPtr, schema);
            fields.push(this.createField(childSchema));
        }
        return new Struct(fields);
    }

    visitList(schema: ArrowSchemaHandle): List {
        // List has 1 child
        const childPtr = binding.getSchemaChild(schema.ptr, 0);
        if (!childPtr) throw new Error('List schema missing child');
        const childSchema = new ArrowSchemaHandle(childPtr, schema);
        return new List(this.createField(childSchema));
    }

    visitLargeList(schema: ArrowSchemaHandle): DataType { throw new Error("LargeList not yet implemented"); }
    visitFixedSizeList(schema: ArrowSchemaHandle): DataType { throw new Error("FixedSizeList not yet implemented"); }
    visitFixedSizeBinary(schema: ArrowSchemaHandle): DataType { throw new Error("FixedSizeBinary not yet implemented"); }

    // --- Helper ---
    public createField(schema: ArrowSchemaHandle): Field {
        const name = binding.getSchemaName(schema.ptr) || '';
        const type = this.visit(schema);
        const flags = binding.getSchemaFlags(schema.ptr);
        const nullable = (flags & 2n) !== 0n;
        return new Field(name, type, nullable);
    }
}
