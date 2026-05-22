/**
 * Creates sample data xlsx/csv files for testing the plugin
 * Run with: node create-sample-data.mjs
 */

import * as XLSX from 'xlsx';
import { mkdirSync, existsSync } from 'fs';

// Create sample-data directory
if (!existsSync('sample-data')) {
  mkdirSync('sample-data');
}

// Sample data that exercises various plugin features
const data = [
  ['Title', 'Author', 'Category', 'Status', 'Rating', 'Notes'],
  ['The Great Gatsby', 'F. Scott Fitzgerald', 'Fiction, Classic', 'Finished', '5', 'A masterpiece of American literature.\n\nExplores themes of wealth and the American Dream.'],
  ['1984', 'George Orwell', 'Fiction, Dystopian', 'Finished', '5', 'Chilling and prescient.'],
  ['Dune', 'Frank Herbert', 'Sci-Fi, Epic', 'In progress', '4', 'Complex world-building.'],
  ['The Hobbit', 'J.R.R. Tolkien', 'Fantasy, Adventure', 'Not started', '', ''],
  ['Clean Code', 'Robert C. Martin', 'Programming, Non-Fiction', 'Finished', '4', 'Essential reading for developers.\n\n## Key Takeaways\n- Write readable code\n- Keep functions small\n- Use meaningful names'],
  ['Project Hail Mary', 'Andy Weir', 'Sci-Fi', 'In progress', '5', 'Gripping from start to finish!'],
  ['Sapiens', 'Yuval Noah Harari', 'History, Non-Fiction', 'Not started', '', 'Recommended by multiple friends.'],
  ['Test: Special "Chars"', 'Author, With Comma', 'Edge Case', 'Finished', '3', 'Tests quoting and escaping.'],
  ['Unicode Test 日本語', 'Tëst Àuthør', 'International', 'Finished', '4', 'Tests unicode handling: émojis 🎉📚'],
  ['Very Long Notes Test', 'Test Author', 'Test', 'Finished', '3', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'],
];

// Create workbook and worksheet
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(data);

// Set column widths
ws['!cols'] = [
  { wch: 25 },  // Title
  { wch: 20 },  // Author
  { wch: 20 },  // Category
  { wch: 12 },  // Status
  { wch: 8 },   // Rating
  { wch: 50 },  // Notes
];

XLSX.utils.book_append_sheet(wb, ws, 'Books');

// Write file
XLSX.writeFile(wb, 'sample-data/test.xlsx');
console.log('Created sample-data/test.xlsx with', data.length - 1, 'sample entries');

// Also create a CSV version
const csvData = data.map(row =>
  row.map(cell => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  }).join(',')
).join('\n');

import { writeFileSync } from 'fs';
writeFileSync('sample-data/test.csv', csvData);
console.log('Created sample-data/test.csv');
