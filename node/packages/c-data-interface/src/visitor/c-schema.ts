import { ArrowSchemaHandle } from '../schema';
import { NanoarrowType } from '../types';
import binding from '../index';

/**
 * Abstract Visitor for C Data Interface Schemas.
 * Subclasses implement specific logic for each type.
 * This class handles the parsing of the format string (via Nanoarrow) and dispatching to the correct method.
 */
export abstract class CSchemaVisitor<T = any> {
    public visit(schema: ArrowSchemaHandle): T {
        const info = binding.getSchemaInfo(schema.ptr);

        switch (info.typeId) {
            case NanoarrowType.NA: return this.visitNull(schema);
            case NanoarrowType.BOOL: return this.visitBool(schema);
            case NanoarrowType.UINT8: return this.visitUint8(schema);
            case NanoarrowType.INT8: return this.visitInt8(schema);
            case NanoarrowType.UINT16: return this.visitUint16(schema);
            case NanoarrowType.INT16: return this.visitInt16(schema);
            case NanoarrowType.UINT32: return this.visitUint32(schema);
            case NanoarrowType.INT32: return this.visitInt32(schema);
            case NanoarrowType.UINT64: return this.visitUint64(schema);
            case NanoarrowType.INT64: return this.visitInt64(schema);
            case NanoarrowType.HALF_FLOAT: return this.visitFloat16(schema);
            case NanoarrowType.FLOAT: return this.visitFloat32(schema);
            case NanoarrowType.DOUBLE: return this.visitFloat64(schema);
            case NanoarrowType.STRING: return this.visitUtf8(schema);
            case NanoarrowType.LARGE_STRING: return this.visitLargeUtf8(schema);
            case NanoarrowType.BINARY: return this.visitBinary(schema);
            case NanoarrowType.LARGE_BINARY: return this.visitLargeBinary(schema);
            case NanoarrowType.FIXED_SIZE_BINARY: return this.visitFixedSizeBinary(schema); // We need to add this method
            case NanoarrowType.DATE64: return this.visitDate64(schema);
            case NanoarrowType.TIMESTAMP: return this.visitTimestamp(schema);
            case NanoarrowType.TIME32: return this.visitTime32(schema);
            case NanoarrowType.TIME64: return this.visitTime64(schema);
            case NanoarrowType.DURATION: return this.visitDuration(schema);
            case NanoarrowType.INTERVAL_MONTHS: return this.visitIntervalMonths(schema);
            case NanoarrowType.INTERVAL_DAY_TIME: return this.visitIntervalDayTime(schema);
            case NanoarrowType.INTERVAL_MONTH_DAY_NANO: return this.visitIntervalMonthDayNano(schema);
            
            // Nested
            case NanoarrowType.STRUCT: return this.visitStruct(schema);
            case NanoarrowType.LIST: return this.visitList(schema);
            case NanoarrowType.LARGE_LIST: return this.visitLargeList(schema);
            case NanoarrowType.FIXED_SIZE_LIST: return this.visitFixedSizeList(schema);
            
            default:
                return this.visitUnsupported(schema);
        }
    }

    abstract visitNull(schema: ArrowSchemaHandle): T;
    abstract visitBool(schema: ArrowSchemaHandle): T;
    abstract visitInt8(schema: ArrowSchemaHandle): T;
    abstract visitUint8(schema: ArrowSchemaHandle): T;
    abstract visitInt16(schema: ArrowSchemaHandle): T;
    abstract visitUint16(schema: ArrowSchemaHandle): T;
    abstract visitInt32(schema: ArrowSchemaHandle): T;
    abstract visitUint32(schema: ArrowSchemaHandle): T;
    abstract visitInt64(schema: ArrowSchemaHandle): T;
    abstract visitUint64(schema: ArrowSchemaHandle): T;
    abstract visitFloat16(schema: ArrowSchemaHandle): T;
    abstract visitFloat32(schema: ArrowSchemaHandle): T;
    abstract visitFloat64(schema: ArrowSchemaHandle): T;
    abstract visitBinary(schema: ArrowSchemaHandle): T;
    abstract visitLargeBinary(schema: ArrowSchemaHandle): T;
    abstract visitFixedSizeBinary(schema: ArrowSchemaHandle): T;
    abstract visitUtf8(schema: ArrowSchemaHandle): T;
    abstract visitLargeUtf8(schema: ArrowSchemaHandle): T;
    
    abstract visitDate32(schema: ArrowSchemaHandle): T;
    abstract visitDate64(schema: ArrowSchemaHandle): T;
    abstract visitTimestamp(schema: ArrowSchemaHandle): T;
    abstract visitTime32(schema: ArrowSchemaHandle): T;
    abstract visitTime64(schema: ArrowSchemaHandle): T;
    abstract visitDuration(schema: ArrowSchemaHandle): T;
    abstract visitIntervalMonths(schema: ArrowSchemaHandle): T;
    abstract visitIntervalDayTime(schema: ArrowSchemaHandle): T;
    abstract visitIntervalMonthDayNano(schema: ArrowSchemaHandle): T;

    abstract visitStruct(schema: ArrowSchemaHandle): T;
    abstract visitList(schema: ArrowSchemaHandle): T;
    abstract visitLargeList(schema: ArrowSchemaHandle): T;
    abstract visitFixedSizeList(schema: ArrowSchemaHandle): T;
    
    visitUnsupported(schema: ArrowSchemaHandle): T {
        throw new Error(`Unsupported C Schema type: ${schema.format}`);
    }
}
