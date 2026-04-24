import fs from 'fs';

const pluginEntry = {
  "id": "git-file-sync",
  "name": "Git File Sync",
  "author": "firstsun-dev",
  "description": "Selectively sync individual notes with GitLab or GitHub. Push, pull, diff, and resolve conflicts — file by file, on mobile and desktop.",
  "repo": "firstsun-dev/git-files-push"
};

const repoDir = '/home/tianyao/obsidian-releases';
const filePath = `${repoDir}/community-plugins.json`;

try {
  const data = fs.readFileSync(filePath, 'utf8');
  const plugins = JSON.parse(data);

  // Remove if it exists
  const filteredPlugins = plugins.filter(p => p.id !== pluginEntry.id);
  
  // ADD TO THE VERY END
  filteredPlugins.push(pluginEntry);

  fs.writeFileSync(filePath, JSON.stringify(filteredPlugins, null, 2) + '\n', 'utf8');

  console.log('Successfully added plugin to the END of community-plugins.json');
} catch (error) {
  console.error('Error:', error.message);
}
