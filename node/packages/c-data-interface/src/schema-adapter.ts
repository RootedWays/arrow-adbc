import { Schema, Field } from 'apache-arrow';
import { ArrowSchemaHandle } from './schema';
import binding from './index';
import { ArrowTypeBuilder } from './visitor/arrow-type-builder';

export function importSchema(schema: ArrowSchemaHandle): Schema {
    const builder = new ArrowTypeBuilder();
    
    // If it's a struct, we treat the struct's children as the schema fields (top-level fields)
    if (schema.format === '+s') {
        const numChildren = binding.getSchemaChildrenCount(schema.ptr);
        const fields: Field[] = [];
        for (let i = 0; i < numChildren; i++) {
            const childPtr = binding.getSchemaChild(schema.ptr, i);
            if (!childPtr) throw new Error(`Missing child schema at index ${i}`);
            
            // Temporarily wrap without releasing ownership (parent owns it)
            const childSchema = new ArrowSchemaHandle(childPtr, schema);
            fields.push(builder.createField(childSchema));
        }
        return new Schema(fields);
    }
    
    // If it's a primitive root (e.g. stream of Int32s), it implies a single field
    return new Schema([builder.createField(schema)]);
}
