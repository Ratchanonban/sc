export interface CaseItem {
  name: string;
  price: number;
  percentage: number;
}

export function scrapeItemsFromDOM(container: Element | Document): CaseItem[] {
  const items: CaseItem[] = [];
  
  // Find all elements containing data-sign="positive" (the price)
  const priceNodes = container.querySelectorAll('[data-sign="positive"]');
  
  priceNodes.forEach(node => {
    try {
      const priceText = node.textContent?.replace(/[^0-9.]/g, '') || "0";
      const price = parseFloat(priceText);
      if (price <= 0) return;

      // The exact structure uses an <a> tag for each condition (MW, FT, etc.) in the tooltip
      const row = node.closest('a');
      if (row) {
         // Find the percentage in this specific row
         const divs = Array.from(row.querySelectorAll('div, span, p'));
         const probNode = divs.find(d => d.textContent?.trim().endsWith('%'));
         
         if (probNode) {
            const probText = probNode.textContent?.replace(/[^0-9.]/g, '') || "0";
            const percentage = parseFloat(probText);
            
            // Name can be extracted from the href URL!
            // e.g. href=".../m4a4-hellfire-well-worn"
            const href = row.getAttribute('href') || "";
            const nameMatch = href.match(/items\/(.+)$/);
            const name = nameMatch ? nameMatch[1].replace(/-/g, ' ') : "Unknown Item";
            
            if (percentage > 0) {
               items.push({ name, price, percentage });
            }
         }
      }
    } catch (err) {}
  });

  // Remove exact duplicates
  const uniqueItemsMap = new Map();
  items.forEach(item => {
    const key = `${item.name}-${item.price}-${item.percentage}`;
    uniqueItemsMap.set(key, item);
  });
  
  return Array.from(uniqueItemsMap.values());
}
