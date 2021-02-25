// This file contains useful helper functions.

var utils = {
	humanFileSize: function(byteSize, si=true, dp=1) {
		const thresh = si ? 1000 : 1024;

		if (Math.abs(byteSize) < thresh) {
			return byteSize + ' B';
		}

		const units = si
		? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
		: ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
		let u = -1;
		const r = 10**dp;

		do {
			byteSize /= thresh;
			++u;
		} while (Math.round(Math.abs(byteSize) * r) / r >= thresh && u < units.length - 1);

		return byteSize.toFixed(dp) + ' ' + units[u];
	}
};