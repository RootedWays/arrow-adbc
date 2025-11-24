import { ArrowSchemaHandle } from './schema';
import { ArrowArrayHandle } from './array';
import binding from './index';
import { NativeBufferInfo } from './types';

export class ArrowBufferExtractor {
    public extract(schema: ArrowSchemaHandle, array: ArrowArrayHandle): NativeBufferInfo {
         const format = schema.format;
         const length = binding.getArrayLength(schema.ptr, array.ptr);
         const nullCount = binding.getArrayNullCount(schema.ptr, array.ptr);
         
         let bufferIndices: number[] = [];
         
         // Map format to required buffer indices
         // This corresponds to the Arrow C Data Interface spec
         switch(format) {
             case 'n': // Null
                 bufferIndices = [];
                 break;
             case 'b': // Boolean
             case 'c': // Int8
             case 'C': // Uint8
             case 's': // Int16
             case 'S': // Uint16
             case 'i': // Int32
             case 'I': // Uint32
             case 'l': // Int64
             case 'L': // Uint64
             case 'e': // Float16
             case 'f': // Float32
             case 'g': // Float64
             case 'D': // Date32
             case 'd': // Date64
             case 't': // Time32
             case 'T': // Time64
                // Validity (0), Data (1)
                bufferIndices = [0, 1];
                break;
             case 'z': // Binary
             case 'Z': // Large Binary
             case 'u': // Utf8
             case 'U': // Large Utf8
                // Validity (0), Offsets (1), Data (2)
                bufferIndices = [0, 1, 2];
                break;
             case '+s': // Struct
                // Validity (0)
                bufferIndices = [0];
                break;
             default:
                // Fallback for unhandled or complex types (structs, lists, etc.)
                // For the purpose of this refactor covering existing tests:
                throw new Error(`Extractor: Unsupported format ${format}`);
         }

         const buffers = bufferIndices.map(idx => binding.getArrayBuffer(schema.ptr, array.ptr, idx));
         
         // Retrieve field name
         const fieldName = binding.getSchemaName(schema.ptr) || undefined;

         const children: NativeBufferInfo[] = [];
         if (format === '+s') {
             const numChildren = binding.getSchemaChildrenCount(schema.ptr);
             for (let i = 0; i < numChildren; i++) {
                 const childSchemaPtr = binding.getSchemaChild(schema.ptr, i);
                 const childArrayPtr = binding.getArrayChild(array.ptr, i);
                 
                 if (!childSchemaPtr || !childArrayPtr) {
                     throw new Error(`Struct child at index ${i} missing`);
                 }
                 
                 // Wrap them temporarily to extract. 
                 // We pass 'schema' (the parent) as the second arg so the child handle 
                 // does not register for release (lifecycle managed by parent).
                 const childSchema = new ArrowSchemaHandle(childSchemaPtr, schema);
                 const childArray = new ArrowArrayHandle(childArrayPtr, array);
                 
                 children.push(this.extract(childSchema, childArray));
             }
         }

         return { format, length, nullCount, buffers, children, fieldName };
    }
}
