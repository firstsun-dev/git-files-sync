import {AbstractInputSuggest, App, TFolder} from 'obsidian';

/**
 * Type-ahead folder suggester for a settings text input. Suggests existing
 * vault folders but never forces a selection, since callers (e.g. the "Root
 * path" repo setting) may need to accept a path that doesn't exist locally.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private readonly inputEl: HTMLInputElement) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const lowerQuery = query.toLowerCase();
		return this.app.vault.getAllFolders(true)
			.filter(folder => folder.path.toLowerCase().contains(lowerQuery))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path === '/' ? '/' : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		const path = folder.path === '/' ? '' : folder.path;
		this.setValue(path);
		// TextComponent listens for the native "input" event to fire onChange,
		// so dispatch one to trigger the existing save/initializeGitService flow.
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}

	/** Attaches a FolderSuggest to `inputEl`; the instance self-registers via the base class, so the caller has nothing to hold onto. */
	static attach(app: App, inputEl: HTMLInputElement): void {
		// eslint-disable-next-line sonarjs/constructor-for-side-effects -- AbstractInputSuggest wires itself to inputEl in its constructor; there's nothing to assign.
		new FolderSuggest(app, inputEl);
	}
}
