import {AbstractInputSuggest, App} from 'obsidian';
import GitLabFilesPush from '../main';

/**
 * Type-ahead folder suggester for the "Root path" setting. Unlike FolderSuggest
 * (which lists local vault folders), this lists folders that actually exist in
 * the configured remote repository, since Root path is a repo-side path and has
 * no relationship to the local vault's folder structure.
 */
export class RemoteFolderSuggest extends AbstractInputSuggest<string> {
	private cachedFolders: string[] | null = null;

	constructor(app: App, private readonly inputEl: HTMLInputElement, private readonly plugin: GitLabFilesPush) {
		super(app, inputEl);
	}

	private async loadFolders(): Promise<string[]> {
		if (this.cachedFolders) return this.cachedFolders;

		const paths = await this.plugin.gitService.listFiles(this.plugin.settings.branch, false);
		const folders = new Set<string>();
		for (const path of paths) {
			const parts = path.split('/');
			parts.pop(); // drop the filename itself
			let acc = '';
			for (const part of parts) {
				acc = acc ? `${acc}/${part}` : part;
				folders.add(acc);
			}
		}

		this.cachedFolders = Array.from(folders).sort((a, b) => a.localeCompare(b));
		return this.cachedFolders;
	}

	protected async getSuggestions(query: string): Promise<string[]> {
		const lowerQuery = query.toLowerCase();
		let folders: string[];
		try {
			folders = await this.loadFolders();
		} catch {
			return [];
		}
		return folders.filter(folder => folder.toLowerCase().contains(lowerQuery));
	}

	renderSuggestion(folder: string, el: HTMLElement): void {
		el.setText(folder);
	}

	selectSuggestion(folder: string): void {
		this.setValue(folder);
		// TextComponent listens for the native "input" event to fire onChange,
		// so dispatch one to trigger the existing save/initializeGitService flow.
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}

	/** Attaches a RemoteFolderSuggest to `inputEl`; the instance self-registers via the base class, so the caller has nothing to hold onto. */
	static attach(app: App, inputEl: HTMLInputElement, plugin: GitLabFilesPush): void {
		// eslint-disable-next-line sonarjs/constructor-for-side-effects -- AbstractInputSuggest wires itself to inputEl in its constructor; there's nothing to assign.
		new RemoteFolderSuggest(app, inputEl, plugin);
	}
}
