export {
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  type Product,
  ProductModel,
  type ProductStatus,
  type ProductType,
  productSchemaDefinition,
} from "./product.model";

export {
  PRODUCT_EDITABLE_FIELDS,
  type ProductEditableField,
  ProductRepository,
  type ProductUpdatePayload,
} from "./product.repository";

export {
  type CreateProductBody,
  createProductBody,
  type UpdateProductBody,
  updateProductBody,
} from "./product.schemas";

export {
  type CreateProductInput,
  ProductError,
  ProductService,
  type UpdateProductInput,
} from "./product.service";
