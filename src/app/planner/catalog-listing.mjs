export function catalogListingKey(product) {
  return JSON.stringify([product.id, product.searchGroup, product.searchTerm, product.ocrImage, product.imageUrl, product.title]);
}
