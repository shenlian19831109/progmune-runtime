// Discussion forum - categories module

interface Category { id: string; name: string; description: string; }
const categories: Category[] = [];

let nextId = 1;

export function addCategory(name: string, description: string): Category {
  const cat: Category = { id: `cat${nextId++}`, name, description };
  categories.push(cat);
  return cat;
}

export function listCategories(): Category[] {
  return categories;
}

export function getCategory(categoryId: string): Category | null {
  return categories.find(c => c.id === categoryId) || null;
}
