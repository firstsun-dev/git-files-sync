import fs from 'fs';

const filePath = '/home/tianyao/obsidian-releases/community-plugins.json';
const entry = {
  "id": "git-file-sync",
  "name": "Git File Sync",
  "author": "firstsun-dev",
  "description": "Selectively sync individual notes with GitLab or GitHub. Push, pull, diff, and resolve conflicts — file by file, on mobile and desktop.",
  "repo": "firstsun-dev/git-files-push"
};

try {
  let content = fs.readFileSync(filePath, 'utf8').trim();
  
  // Find the last closing bracket of the main array
  const lastBracketIndex = content.lastIndexOf(']');
  if (lastBracketIndex === -1) throw new Error('Could not find closing bracket');

  // Prepare the entry string with correct indentation (2 spaces)
  const entryStr = `,\n  {\n    "id": "${entry.id}",\n    "name": "${entry.name}",\n    "author": "${entry.author}",\n    "description": "${entry.description}",\n    "repo": "${entry.repo}"\n  }`;

  // Construct the new content
  const newContent = content.substring(0, lastBracketIndex) + entryStr + "\n]";
  
  fs.writeFileSync(filePath, newContent + '\n', 'utf8');
  console.log('Successfully appended plugin entry to the end without reformatting the file.');
} catch (error) {
  console.error('Error:', error.message);
}
