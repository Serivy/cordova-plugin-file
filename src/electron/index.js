/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */
const fs = require('fs');
const nodePath = require('path');
const electron = require('electron');

// Brought in with package.json.
const mime = require('mime-types');

const FileError = {
    // File error codes
    // Found in DOMException
    NOT_FOUND_ERR: 1,
    SECURITY_ERR: 2,
    ABORT_ERR: 3,
    
    // Added by File API specification
    NOT_READABLE_ERR: 4,
    ENCODING_ERR: 5,
    NO_MODIFICATION_ALLOWED_ERR: 6,
    INVALID_STATE_ERR: 7,
    SYNTAX_ERR: 8,
    INVALID_MODIFICATION_ERR: 9,
    QUOTA_EXCEEDED_ERR: 10,
    TYPE_MISMATCH_ERR: 11,
    PATH_EXISTS_ERR: 12
}

var pathsPrefix = {
    // Read-only directory where the application is installed.
    applicationDirectory: nodePath.dirname(electron.app.getAppPath()) + nodePath.sep,
    // Where to put app-specific data files.
    dataDirectory: nodePath.resolve(electron.app.getPath('userData'), 'data') + nodePath.sep,
    documentsDirectory: nodePath.resolve(electron.app.getPath('documents'), electron.app.getName()) + nodePath.sep,
    // Cached files that should survive app restarts.
    // Apps should not rely on the OS to delete files in here.
    cacheDirectory: electron.app.getPath('temp') + nodePath.sep,
    tempDirectory: electron.app.getPath('temp') + nodePath.sep
};

const toEntry = function(name, fullPath, lastModified = null) {
    return {
        name: name,
        fullPath: fullPath,
        size: 0,
        lastModifiedDate: lastModified ?? new Date(),
        storagePath: fullPath
    }
}

const requestAllPathsHandler = async (args) => {
    return pathsPrefix;
}

const getDirectoryHandler = async (args) => {
    var rootPath = args[0];
    var path = args[1];
    var options = args[2];

    // Create an absolute path if we were handed a relative one.
    // https://nodejs.org/docs/latest-v10.x/api/path.html#path_path_resolve_paths
    let fullPath = nodePath.resolve(rootPath, path);
    let pathName = nodePath.basename(fullPath);

    /** @type {fs.Stats} */
    let folderEntry = null;
    try {
        // https://nodejs.org/docs/latest-v10.x/api/fs.html#fs_fs_stat_path_options_callback
        folderEntry = await new Promise((resolve, reject) => { fs.stat(fullPath, (err, stats) => { if (err) { reject(err); } else { resolve(stats); } }) });
        doesFileExist = true;
    } catch (e) {
        if (e.code !== "ENOENT") {
            throw e;
        }
    }

    if (!options) {
        options = {};
    }

    if (options.create === true && options.exclusive === true && folderEntry) {
        // If create and exclusive are both true, and the path already exists,
        // getDirectory must fail.
        throw FileError.PATH_EXISTS_ERR;
        // There is a strange bug in mobilespec + FF, which results in coming to multiple else-if's
        // so we are shielding from it with returns.
        return;
    }

    if (options.create === true && !folderEntry) {
        // If create is true, the path doesn't exist, and no other error occurs,
        // getDirectory must create it as a zero-length file and return a corresponding
        // MyDirectoryEntry.

        // https://nodejs.org/docs/latest-v10.x/api/fs.html#fs_fs_open_path_flags_mode_callback
        var mkdir = await new Promise((resolve, reject) => { fs.mkdir(fullPath, (err) => { if (err) { reject(err); } else { resolve(); } }) });
        return {
            name: pathName,
            fullPath: fullPath,
            size: 0,
            lastModifiedDate: new Date(),
            storagePath: fullPath
        };
    }

    if (options.create === true && folderEntry) {

        if (folderEntry.isDirectory()) {
            // IDB won't save methods, so we need re-create the MyDirectoryEntry.
            return {
                name: folderEntry.name,
                fullPath: fullPath,
                size: 0,
                lastModifiedDate: new Date(),
                storagePath: fullPath
            };
        } else {
            throw (FileError.INVALID_MODIFICATION_ERR);
        }
        return;
    }

    if ((!options.create || options.create === false) && !folderEntry) {
        // Handle root special. It should always exist.
        if (rootPath === DIR_SEPARATOR) {
            return fileSystem.root;
        }

        // If create is not true and the path doesn't exist, getDirectory must fail.
        throw (FileError.NOT_FOUND_ERR);
        return;
    }
    if ((!options.create || options.create === false) && folderEntry && folderEntry.isFile()) {
        // If create is not true and the path exists, but is a file, getDirectory
        // must fail.
            throw (FileError.TYPE_MISMATCH_ERR);
        return;
    }

    // Otherwise, if no other error occurs, getDirectory must return a
    // MyDirectoryEntry corresponding to path.

    // IDB won't' save methods, so we need re-create MyDirectoryEntry.
    return {
        name: pathName,
        fullPath: fullPath,
        size: 0,
        lastModifiedDate: new Date(),
        storagePath: fullPath
    };
}

const removeRecursively = async (args) => {
    var [fullPath] = args;
    // Has to be a directory?
    let stats = await new Promise((resolve, reject) => { fs.stat(fullPath, (err, stats) => { if (err) { reject(err); } else { resolve(stats); } }) });
    if (stats.isDirectory()) {
        // https://nodejs.org/docs/latest-v14.x/api/fs.html#fs_fspromises_rm_path_options
        await new Promise((resolve, reject) => { fs.rm(fullPath, { recursive: true }, (err, stats) => { if (err) { reject(err); } else { resolve(stats); } }) });
    } else {
        throw FileError.INVALID_STATE_ERR;
    }
}

/**
 * https://www.w3.org/TR/2012/WD-file-system-api-20120417/#widl-DirectoryEntry-getFile-void-DOMString-path-Flags-options-EntryCallback-successCallback-ErrorCallback-errorCallback
 * @param {*} param0 
 * @returns {Entry}
 */
const getFileHandler = async (args) => {
    var [dirname, path, options] = args;
    let fullPath = dirname + path;
    let baseName = nodePath.basename(fullPath);

    // Get a file instnace if it exists.

    /** @type {FileEntry} */
    let newFileEntry = null;

    // See if the file exists.
    let doesFileExist = false;

    /** @type {fs.Stats} */
    let stats = null;
    try {
        // https://nodejs.org/docs/latest-v10.x/api/fs.html#fs_fs_stat_path_options_callback
        stats = await new Promise((resolve, reject) => { fs.stat(fullPath, (err, stats) => { if (err) { reject(err); } else { resolve(stats); } }) });
        doesFileExist = true;
    } catch (e) {
        if (e.code !== "ENOENT") {
            throw e;
        }
    }

    try {
        if (options.create === true && options.exclusive === true && stats) {
            // If create and exclusive are both true, and the path already exists,
            // getFile must fail.
    
            throw FileError.PATH_EXISTS_ERR;
        } else if (options.create === true && !stats) {
            // If create is true, the path doesn't exist, and no other error occurs,
            // getFile must create it as a zero-length file and return a corresponding
            // FileEntry.
            let newFileEntry = await new Promise((resolve, reject) => { fs.open(fullPath, 'w', (err, fd) => { if (err) { reject(err); } else { resolve(fd); } }) });
            await new Promise((resolve, reject) => { fs.close(newFileEntry, (err) => { if (err) { reject(err); } else { resolve(); } }) });
    
            return toFileEntry(fullPath);
        } else if (options.create === true && stats) {
            // https://nodejs.org/docs/latest-v10.x/api/fs.html#fs_fs_open_path_flags_mode_callback
            if (stats.isFile()) {
                // File exists, I think technically is meant to overwrite it 'w' but android/ios seem to append 'a'.
                let fd = await new Promise((resolve, reject) => { fs.open(fullPath, 'a', (err, fd) => { if (err) { reject(err); } else { resolve(fd); } }) });
                await new Promise((resolve, reject) => { fs.close(fd, (err) => { if (err) { reject(err); } else { resolve(); } }) });

                return toFileEntry(fullPath);
                
            } else {
                throw FileError.INVALID_MODIFICATION_ERR;
            }
    
            return toFileEntry(fullPath);
        } else if ((!options.create || options.create === false) && !stats) {
            // Apparently is this now acceptable according to android and ios.
            return toFileEntry(fullPath);
            // If create is not true and the path doesn't exist, getFile must fail.
            throw FileError.NOT_FOUND_ERR;
        } else if ((!options.create || options.create === false) && stats && stats.isDirectory()) {
            // If create is not true and the path exists, but is a directory, getFile
            // must fail.
            throw FileError.TYPE_MISMATCH_ERR;
        } else {
            // Otherwise, if no other error occurs, getFile must return a FileEntry
            // corresponding to path.
    
            return toFileEntry(fullPath);
        }
    } catch(e) {
        throw e;
    } finally {
        if (newFileEntry) {
            await new Promise((resolve, reject) => { fs.close(newFileEntry, (err) => { if (err) { reject(err); } else { resolve(); } }) });
        }
    }


    // /** @type {FileEntry} */
    // if (fileEntry) {
    //     try {
    //         await new Promise((resolve, reject) => { fs.close(fileEntry, (err) => { if (err) { reject(err); } else { resolve(); } }) });
    //     } catch (e) {
    //     }
    // }

    // if (options.create) {
    //     let fd = await new Promise((resolve, reject) => { fs.open(fullPath, 'w', (err, fd) => { if (err) { reject(err); } else { resolve(fd); } }) });
    //     await new Promise((resolve, reject) => { fs.close(fd, (err) => { if (err) { reject(err); } else { resolve(); } }) });
    // }

    // return {
    //     name: baseName,
    //     fullPath: fullPath
    // }
}

const readEntriesHandler = async (args) => {
    var [dirname] = args;
    var results = [];
    let files = await new Promise((resolve, reject) => { fs.readdir(dirname, {withFileTypes: true}, (err, files) => { if (err) { reject(err); } else { resolve(files); } }) });
    for (var file of files) {
        let path = dirname + file.name;
        if (file.isDirectory()) {
            path += nodePath.sep;
        }
        
        results.push({
            isDirectory: file.isDirectory(),
            isFile: file.isFile(),
            name: file.name,
            fullPath: path,
            filesystemName: 'temporary',
            nativeURL: path
        });

    }

    return results;
}

const getFileMetadata = async (args) => {
    var [baseURLstr] = args;
    // log("getFileMetadata " + JSON.stringify(args));
    
    // JSONObject metadata = new JSONObject();
    // long size = inputURL.isDirectory ? 0 : getAssetSize(inputURL.path);
    // try {
    //     metadata.put("size", size);
    //     metadata.put("type", inputURL.isDirectory ? "text/directory" : resourceApi.getMimeType(toNativeUri(inputURL)));
    //     metadata.put("name", new File(inputURL.path).getName());
    //     metadata.put("fullPath", inputURL.path);
    //     metadata.put("lastModifiedDate", 0);
    // } catch (JSONException e) {
    //     return null;
    // }
    // return metadata;

    try {
        let stats = await new Promise((resolve, reject) => { fs.stat(baseURLstr, (err, stats) => { if (err) { reject(err); } else { resolve(stats); } }) });
            
        // let size = 0; // inputURL.isDirectory ? 0 : getAssetSize(inputURL.path);
        // log(JSON.stringify(stats));
        const name = nodePath.basename(baseURLstr);
        let metadata = {
            size: stats.size,
            type: getMimeTypeFromFile(name), //"text/directory", // inputURL.isDirectory ? "text/directory" : resourceApi.getMimeType(toNativeUri(inputURL)));
            name: name, // new File(inputURL.path).getName());
            fullPath: baseURLstr, // inputURL.path
            lastModifiedDate: stats.mtime
        }
        return metadata;
    } catch (e) {
        return null;
    }
}

const setMetadata = async (args) => {
    throw "not implemented";
}

const moveToHandler = async (args) => {
    var srcPath = args[0];
    // parentFullPath and name parameters is ignored because
    // args is being passed downstream to exports.copyTo method
    var parentFullPath = args[1]; // eslint-disable-line no-unused-vars
    var name = args[2]; // eslint-disable-line no-unused-vars

    // https://nodejs.org/docs/latest-v14.x/api/fs.html#fs_fspromises_rename_oldpath_newpath
    // await fs.fsPromises.rename(srcPath, name);
    const target = nodePath.resolve(parentFullPath, name);
    await new Promise((resolve, reject) => { fs.rm(target, { force: true }, (err) => { if (err) { reject(err); } else { resolve(); } }) });
    await new Promise((resolve, reject) => { fs.rename(srcPath, target, (err, stats) => { if (err) { reject(err); } else { resolve(stats); } }) });
    return toEntry(name, target, null);
}

const copyToHandler = async (args) => {
    var srcPath = args[0];
    var parentFullPath = args[1];
    var name = args[2];
    const target = nodePath.resolve(parentFullPath, name);
    // https://nodejs.org/docs/latest-v14.x/api/fs.html#fs_fs_copyfile_src_dest_mode_callback
    await new Promise((resolve, reject) => { fs.copyFile(srcPath, target, (err, stats) => { if (err) { reject(err); } else { resolve(stats); } }) });
    return toEntry(name, target, null);
}

const removeHandler = async (args) => {
    var [fullPath] = args;
    try {
        let stats = await new Promise((resolve, reject) => { fs.stat(fullPath, (err, stats) => { if (err) { reject(err); } else { resolve(stats); } }) });
        if (stats.isDirectory()) {
            // https://nodejs.org/docs/latest-v14.x/api/fs.html#fs_fs_rmdir_path_options_callback
            await new Promise((resolve, reject) => { fs.rmdir(fullPath, { recursive: false }, (err) => { if (err) { reject(err); } else { resolve(); } }) });
        } else {
            await new Promise((resolve, reject) => { fs.unlink(fullPath, (err) => { if (err) { reject(err); } else { resolve(); } }) });
        }
    } catch (e) {
        // Android and IOS don't fail when a file doesnt exist to be deleted.
        if (e.code === "ENOENT") {
            return;
        }

        throw e;
    }
}

const getParentHandler = async (args) => {
    throw "not implemented";
}

const readAsDataURLHandler = async (args) => {
    const [fname, start, end] = args;
    const buffer = await readAsBuffer(fname, start, end);
    const encoding = "base64";
    const mime = getMimeTypeFromFile(fname);
    const base64 = buffer.toString(encoding);
    const uri = "data:" + mime + ';' + encoding + ',' + base64; 
    return uri;
}

function getMimeTypeFromFile(filename) {
    // const mime = "text/plain";
    const mimeType = mime.lookup(filename) || 'application/octet-stream'
    return mimeType;
}

const readAsBinaryStringHandler = async (args) => {
    const [fname, start, end] = args;
    const bufferFile = await readAsBuffer(fname, start, end);
    return bufferFile.toString("binary");
}

const readAsArrayBufferHandler = async (args) => {
    const [fname, start, end] = args;
    const buffer = readAsBuffer(fname, start, end);
    return buffer;
}

const readAsTextHandler = async (args) => { 
    const [fname, encoding, start, end] = args;
    const buffer = Buffer.alloc(end - start);
    let fd = await new Promise((resolve, reject) => { fs.open(fname, 'r', (err, fd) => { if (err) { reject(err); } else { resolve(fd); } }) });
    await new Promise((resolve, reject) => { fs.read(fd, buffer, 0, buffer.length, start, (err) => { if (err) { reject(err); } else { resolve(buffer); } }) });
    await new Promise((resolve, reject) => { fs.close(fd, (err) => { if (err) { reject(err); } else { resolve(); } }) });
    return buffer.toString(encoding);
}

const readAsBuffer = async function(fname, start, end) {
    const buffer = Buffer.alloc(end - start);
    let fd = await new Promise((resolve, reject) => { fs.open(fname, 'r', (err, fd) => { if (err) { reject(err); } else { resolve(fd); } }) });
    await new Promise((resolve, reject) => { fs.read(fd, buffer, 0, buffer.length, start, (err) => { if (err) { reject(err); } else { resolve(buffer); } }) });
    await new Promise((resolve, reject) => { fs.close(fd, (err) => { if (err) { reject(err); } else { resolve(); } }) });
    return buffer;
}

const writeHandler = async (args) => {
    var [fname, data, offset, isBinary] = args;
    var nativeURL;
    const buffer = Buffer.from(data ? data : "");

    let fd = await new Promise((resolve, reject) => { fs.open(fname, 'a', (err, fd) => { if (err) { reject(err); } else { resolve(fd); } }) });
    let writeBytes = await new Promise((resolve, reject) => {
        fs.write(fd, buffer, 0, buffer.length, offset, (err, written, buffer) => { if (err) { reject(err) } else { resolve(written); } });
    });
    await new Promise((resolve, reject) => { fs.close(fd, (err) => { if (err) { reject(err); } else { resolve(); } }) });

    return writeBytes;
}

const requestFileSystemHandler = async (args) => {
    const [fstype, requiredSize] = args;
    let requestedPath = fstype == 1 ? pathsPrefix.dataDirectory : pathsPrefix.tempDirectory;
    // Could check to see if requiredSize storage exists on disk.

    try {
        const resolved = await resolveLocalFileSystemURIHandler([requestedPath]);
    
        return {
            name: requestedPath,
            root: resolved
        };
    } catch(e) {
        throw FileError.NOT_FOUND_ERR;
    }
}



const truncateHandler = async (args) => {
    var path = args[0];
    var len = args[1];
    
    if (!path) {
        throw FileError.NOT_FOUND_ERR;
    }

    await new Promise((resolve, reject) => { fs.truncate(path, len, (err) => { if (err) { reject(err); } else { resolve(); } }) });
}

const resolveLocalFileSystemURIHandler = async (args) => {
    var path = nodePath.resolve(args[0]);

    if (!path) {
        throw FileError.NOT_FOUND_ERR;
    }

    if (Object.values(pathsPrefix).map(o => o.startsWith(path)).indexOf(true) >= 0) {
        try {
            /** @type {fs.Stats} */
            let stats = await new Promise((resolve, reject) => { fs.stat(path, (err, s) => { if (err) { reject(err); } else { resolve(s); } }) });
            return toDirectoryEntry(path, 'temporary');
        } catch (e) {
            // May not exist, create it.
            await new Promise((resolve, reject) => { fs.mkdir(path, (err) => { if (err) { reject(err); } else { resolve(); } }) });
            return toDirectoryEntry(path, 'temporary');
        }
    } else {
        throw FileError.NOT_READABLE_ERR;
    }
}

const notifyNotSupported = async (args) => {
    throw "not implemented";
}

const _getLocalFilesystemPathHandler = async (args) => {
    throw "not implemented";
}

const pathToFileSystemEntry = (requestedPath, stats) => {
    return {
        name: requestedPath,
        root: toRootFileSystem(requestedPath, nodePath.basename(requestedPath), nodePath.dirname(requestedPath), stats.isDirectory())
    };
}

const toRootFileSystem = (uri, fsName, fsPath, isDirectory) => {
    return {
        isFile: !isDirectory,
        isDirectory: isDirectory,
        name: fsName,
        fullPath: fsPath,
        filesystemName: fsName,
        filesystem: "temporary" == fsName ? 0 : 1,
        nativeURL: fsPath
    };
}

const toDirectoryEntry = (path, filesystem) => {
    const name = nodePath.basename(path);
    return {
        isFile: false,
        isDirectory: true,
        name: name,
        fullPath: path,
        filesystem: filesystem ?? 'temporary',
        filesystemName: filesystem ? filesystem : 'temporary',
        nativeURL: path
    };
}

const toFileEntry = (fullPath) => {
    const name = nodePath.basename(fullPath);
    return {
        name: name,
        fullPath: fullPath,
        size: 0,
        lastModifiedDate: new Date(),
        storagePath: fullPath
    }
}

// https://cordova.apache.org/docs/en/11.x/reference/cordova-plugin-file/index.html
module.exports = {
    requestAllPaths: requestAllPathsHandler,
    getDirectory: getDirectoryHandler,
    removeRecursively: removeRecursively,
    getFile: getFileHandler,
    readEntries: readEntriesHandler,
    getFileMetadata: getFileMetadata,
    setMetadata: setMetadata,
    moveTo: moveToHandler,
    copyTo: copyToHandler,
    remove: removeHandler,
    getParent: getParentHandler,
    readAsDataURL: readAsDataURLHandler,
    readAsBinaryString: readAsBinaryStringHandler,
    readAsArrayBuffer: readAsArrayBufferHandler,
    readAsText: readAsTextHandler,
    write: writeHandler,
    requestFileSystem: requestFileSystemHandler,
    resolveLocalFileSystemURI: resolveLocalFileSystemURIHandler,
    truncate: truncateHandler,
    // exec's below are not implemented in browser platform
    requestAllFileSystems: notifyNotSupported,
    // method below is used for backward compatibility w/ old File plugin implementation
    _getLocalFilesystemPath: _getLocalFilesystemPathHandler
};

// sessionData
// console.log(
//     ["home","appData","userData","temp","exe","module","desktop","documents","downloads","music","pictures","videos","recent","logs","crashDumps"].map(o => "id:"+o +": "+ electron.app.getPath(o)+"\n")
// );

// [
//     'id:home: <USER>\n',
//     'id:appData: <USER>\\AppData\\Roaming\n',
//     'id:userData: <USER>\\AppData\\Roaming\\Electron\n',
//     'id:temp: <USER>\\AppData\\Local\\Temp\n',
//     'id:exe: C:\\dev\\cordova-plugin-file-electron-test\\node_modules\\electron\\dist\\electron.exe\n',
//     'id:module: C:\\dev\\cordova-plugin-file-electron-test\\node_modules\\electron\\dist\\electron.exe\n',
//     'id:desktop: <USER>\\Desktop\n',
//     'id:documents: <USER>\\Documents\n',
//     'id:downloads: <USER>\\Downloads\n',
//     'id:music: <USER>\\Music\n',
//     'id:pictures: <USER>\\Pictures\n',
//     'id:videos: <USER>\\Videos\n',
//     'id:recent: <USER>\\AppData\\Roaming\\Microsoft\\Windows\\Recent\n',      
//     'id:logs: <USER>\\AppData\\Roaming\\Electron\\logs\n',
//     'id:crashDumps: <USER>\\AppData\\Roaming\\Electron\\Crashpad\n'
//   ]