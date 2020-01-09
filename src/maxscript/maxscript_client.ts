import { IMaxscriptClient, IBakeTexturesFilenames, ISettings } from "../interfaces";
import { Socket } from "net";
import { Workspace } from "../database/model/workspace";

const md5 = require('md5');

// communicates to remote maxscript endpoint
class MaxscriptClient implements IMaxscriptClient {

    private _settings: ISettings;
    private _responseHandler:        (this: MaxscriptClient, data: any) => void;
    private _errorHandler:           (this: MaxscriptClient, err: any) => void;
    private _client: Socket;

    constructor(settings: ISettings) {
        this._settings = settings;
    }

    connect(ip: string, port: number): Promise<boolean> {

        return new Promise<boolean>(function(this: MaxscriptClient, resolve, reject) {

            this._client = new Socket();

            this._client.on('data', function(this: MaxscriptClient, data) {
                if (this._responseHandler) {
                    this._responseHandler(data);
                }
            }.bind(this));

            this._client.on('error', function(this: MaxscriptClient, err) {
                if (this._errorHandler) {
                    this._errorHandler(err);
                }
                reject(err)
            }.bind(this));

            this._client.on('close', function(this: MaxscriptClient) {
                // just ok
            }.bind(this));

            // now connect and test a connection with some simple command
            this._client.connect(port, ip, function(this: MaxscriptClient) {
                resolve(true);
            }.bind(this));

        }.bind(this));
    }

    disconnect() {
        if (this._client) {
            this._client.destroy();
            this._client = null;
        }
    }

    execMaxscript(maxscript: string, actionDesc: string, responseChecker: (resp: string) => boolean = null): Promise<boolean> {
        // console.log(` MAXSCRIPT: \n${maxscript}`);
        const startedAt = Date.now();

        return new Promise<boolean>(function(this: MaxscriptClient, resolve, reject) {
            // prepare response handlers for the command

            const actionDesc2 = actionDesc;
            const startedAt2 = startedAt;

            this._responseHandler = function(this: MaxscriptClient, data) {
                this._responseHandler = undefined;

                let maxscriptResp = data.toString();
                if (maxscriptResp && maxscriptResp !== "OK") {
                    console.log(`       >> maxscript = ${maxscript}`);
                    console.log(`   LOG | MaxscriptClient.${actionDesc} returned: ${maxscriptResp}` );
                }
                
                if (responseChecker) {
                    if (responseChecker(maxscriptResp)) {
                        console.log(` >> maxscript resolved: `, actionDesc2, (Date.now() - startedAt2) + "ms." )
                        resolve();
                    } else {
                        reject(Error(`Unexpected maxscript response: ${maxscriptResp}`));
                    }
                } else {
                    if (maxscriptResp.indexOf("FAIL") === -1 && maxscriptResp.indexOf("Exception") === -1) {
                        console.log(` >> maxscript resolved: `, actionDesc2, (Date.now() - startedAt2) + "ms." )
                        resolve();
                    } else {
                        reject(Error(`Unexpected maxscript response: ${maxscriptResp}`));
                    }
                }
            };

            this._errorHandler = function(this: MaxscriptClient, err) {
                console.log ( `      >> maxscript = ${maxscript}`);
                console.error(`  FAIL | MaxscriptClient.${actionDesc} error: `, err);
                reject(err);
            };

            if (maxscript) {
                this._client.write(maxscript);
            } else {
                reject(Error("empty maxscript"));
            }

        }.bind(this));
    }

    resetScene(): Promise<boolean> {
        let maxscript = `resetMaxFile #noPrompt`;
        return this.execMaxscript(maxscript, "resetScene");
    }

    openScene(maxSceneFilename: string, workspace: Workspace): Promise<boolean> {
        let maxscript = `resetMaxFile #noPrompt ; \r\n`
                        + `disableSceneRedraw(); \r\n`
                        + `sceneFilename = "${workspace.homeDir}\\\\api-keys\\\\${workspace.apiKey}\\\\workspaces\\\\${workspace.guid}\\\\scenes\\\\${maxSceneFilename}" ; \r\n`
                        + `if existFile sceneFilename then ( \r\n`
                        + `     sceneLoaded = loadMaxFile sceneFilename useFileUnits:true quiet:true ; \r\n`
                        + `     if sceneLoaded then ( \r\n`
                        + `         print "OK | scene open" \r\n`            
                        + `     ) else ( \r\n`
                        + `         print "FAIL | failed to load scene" \r\n`
                        + `     ) \r\n`
                        + ` ) else ( \r\n`
                        + `     print "FAIL | scene file not found" \r\n`
                        + ` ) `;

        return this.execMaxscript(maxscript, "openScene");
    }

    setObjectWorldMatrix(nodeName, matrixWorldArray): Promise<boolean> {
        let m = matrixWorldArray;
        let maxscript = `in coordsys world $${nodeName}.transform = (matrix3 [${m[0]},${m[1]},${m[2]}] [${m[4]},${m[5]},${m[6]}] [${m[8]},${m[9]},${m[10]}] [${m[12]},${m[13]},${m[14]}])`;
        console.log(" >> setObjectWorldMatrix: ");
        console.log(" >> maxscript: \r\n", maxscript);
        return this.execMaxscript(maxscript, "setObjectWorldMatrix");
    }

    setObjectMatrix(nodeName, matrixArray): Promise<boolean> {
        let m = matrixArray;
        let maxscript = `$${nodeName}.transform = `
                + ` (matrix3 [${m[0]},${m[1]},${m[2]}] [${m[4]},${m[5]},${m[6]}] [${m[8]},${m[9]},${m[10]}] [${m[12]},${m[13]},${m[14]}]) `
                + ` * $${nodeName}.parent.transform`;

        console.log(" >> setObjectMatrix: ");
        console.log(" >> maxscript: \r\n", maxscript);
        return this.execMaxscript(maxscript, "setObjectMatrix");
    }

    linkToParent(nodeName: string, parentName: string): Promise<boolean> {
        let maxscript = `$${nodeName}.parent = $${parentName}`;
        console.log(" >> linkToParent: ");
        console.log(" >> maxscript: \r\n", maxscript);
        return this.execMaxscript(maxscript, "linkToParent");
    }

    renameObject(nodeName: string, newName: string): Promise<boolean> {
        let maxscript = `$${nodeName}.name = "${newName}"`;
        return this.execMaxscript(maxscript, "renameObject");
    }

    setSession(sessionGuid: string): Promise<boolean> {
        let maxscript = `SessionGuid = "${sessionGuid}"`;
        return this.execMaxscript(maxscript, "setSession");
    }

    setWorkspace(workspaceInfo: any): Promise<boolean> {
        let w = workspaceInfo;

        let maxscript = `for i=1 to pathConfig.mapPaths.count() do ( pathConfig.mapPaths.delete 1 )\r\n`
                      + `for i=1 to pathConfig.xrefPaths.count() do ( pathConfig.xrefPaths.delete 1 )\r\n`
                      + `pathConfig.mapPaths.add "${w.homeDir}\\\\api-keys\\\\${w.apiKey}\\\\workspaces\\\\${w.guid}\\\\maps"\r\n`
                      + `pathConfig.xrefPaths.add "${w.homeDir}\\\\api-keys\\\\${w.apiKey}\\\\workspaces\\\\${w.guid}\\\\xrefs"` ;

        return this.execMaxscript(maxscript, "setWorkspace");
    }

    createSceneRoot(maxName: string): Promise<boolean> {
        let maxscript = `aSceneRoot = Dummy() ; \r\n`
                        + ` aSceneRoot.name = \"${maxName}\" ; \r\n`
                        + ` rotate aSceneRoot (eulerangles 90 0 0)`;

        console.log(" >> SCENE ROOT: ", maxscript);

        return this.execMaxscript(maxscript, "createSceneRoot");
    }

    createDummy(maxName: string): Promise<boolean> {
        let maxscript = `aDummy = Dummy() ; \r\n`
                     + ` aDummy.name = \"${maxName}\" ;`;

        console.log(" >> DUMMY: ", maxscript);

        return this.execMaxscript(maxscript, "createDummy");
    }

    createTargetCamera(cameraName: string, cameraJson: any): Promise<boolean> {
        let maxscript = `aFreeCamera = FreeCamera `
                        + ` nearclip:1 farclip:1000 nearrange:0 farrange:1000 `
                        + ` mpassEnabled:off mpassRenderPerPass:off `
                        + ` isSelected:on name:\"${cameraName}\" ; \r\n`
                        + ` aFreeCamera.fovType = 2 ; \r\n`
                        + ` aFreeCamera.curFOV = ${cameraJson.fov}`;

        console.log(" >> createTargetCamera: ");
        console.log(" >> maxscript: \r\n", maxscript);

        return this.execMaxscript(maxscript, "createTargetCamera");
    }

    updateTargetCamera(cameraName: string, cameraJson: any): Promise<boolean> {
        let maxscript = `aFreeCamera = $${cameraName} ; \r\n`
                        + ` aFreeCamera.fovType = 2 ; \r\n`
                        + ` aFreeCamera.curFOV = ${cameraJson.fov}`;

        console.log(" >> updateTargetCamera: ");
        console.log(" >> maxscript: \r\n", maxscript);

        return this.execMaxscript(maxscript, "updateTargetCamera");
    }

    cloneInstance(nodeName: string, cloneName: string): Promise<boolean> {
        let maxscript = `aClone = instance $${nodeName} name:"${cloneName}" ; \r\n`
                      + `aClone.parent = null ; \r\n`
                      + `aClone.transform = (matrix3 [1,0,0] [0,1,0] [0,0,1] [0,0,0])`;

        return this.execMaxscript(maxscript, "cloneInstance");
    }

    deleteObjects(mask: string): Promise<boolean> {
        let maxscript = `delete $${mask}`;
        return this.execMaxscript(maxscript, "deleteObjects");
    }

    createSpotlight(spotlightJson: any): Promise<boolean> {
        let m = spotlightJson.matrix;
        let r = (spotlightJson.color >> 16) & 0xFF;
        let g = (spotlightJson.color >> 8)  & 0xFF;
        let b = (spotlightJson.color)       & 0xFF;

        let hotspot = 180.0 / (Math.PI / spotlightJson.angle);
        let falloff = hotspot + 5;

        let t = spotlightJson.target;

        let maxscript = `aTargetSpot = TargetSpot name: "${spotlightJson.name}" `
                        + ` transform: (matrix3 [${m[0]},${m[1]},${m[2]}] [${m[4]},${m[5]},${m[6]}] [${m[8]},${m[9]},${m[10]}] [${m[12]},${m[13]},${m[14]}]) `
                        + ` multiplier: ${spotlightJson.intensity} `
                        + ` rgb: (color ${r} ${g} ${b}) `
                        + ` hotspot: ${hotspot} `
                        + ` falloff: ${falloff} `
                        + ` target: (Targetobject transform: (matrix3 [${t[0]},${t[1]},${t[2]}] [${t[4]},${t[5]},${t[6]}] [${t[8]},${t[9]},${t[10]}] [${t[12]},${t[13]},${t[14]}])); `
                        + ` aTargetSpot.shadowGenerator = shadowMap(); aTargetSpot.baseObject.castShadows = true; `
                        + ` aTargetSpot.parent = threejsSceneRoot; `
                        + ` aTargetSpot.target.parent = threejsSceneRoot; `;

        if (spotlightJson.shadow && spotlightJson.shadow.mapsize > 0) {
            maxscript += ` aTargetSpot.mapSize = ${spotlightJson.shadow.mapsize}; `;
        }

        return this.execMaxscript(maxscript, "createSkylight");
    }

    createMaterial(materialJson: any): Promise<boolean> {
        let diffuse = {
            r: (materialJson.color >> 16) & 0xFF,
            g: (materialJson.color >> 8)  & 0xFF,
            b: (materialJson.color)       & 0xFF
        };

        let specular = {
            r: (materialJson.specular >> 16) & 0xFF,
            g: (materialJson.specular >> 8)  & 0xFF,
            b: (materialJson.specular)       & 0xFF
        };

        let emissive = {
            r: (materialJson.emissive >> 16) & 0xFF,
            g: (materialJson.emissive >> 8)  & 0xFF,
            b: (materialJson.emissive)       & 0xFF
        };

        let maxscript = `StandardMaterial name:"${materialJson.name}" ` 
                        + ` diffuse: (color ${diffuse.r}  ${diffuse.g}  ${diffuse.b}) `
                        + ` specular:(color ${specular.r} ${specular.g} ${specular.b}) `
                        + ` emissive:(color ${emissive.r} ${emissive.g} ${emissive.b}) `
                        + ` opacity: ${materialJson.opacity !== undefined ? 100 * materialJson.opacity : 100} `
                        + ` glossiness: ${materialJson.shininess !== undefined ? materialJson.shininess : 30} `
                        + ` specularLevel: 75 `
                        + ` shaderType: 5 `; // for Phong

        return this.execMaxscript(maxscript, "createMaterial");
    }

    downloadJson(url: string, path: string): Promise<boolean> {
        console.log(" >> Downloading json from:\n" + url);

        const curlPath = "C:\\\\bin\\\\curl";
        let maxscript = `cmdexRun "${curlPath} -k -s -H \\\"Accept: application/json\\\" \\\"${url}\\\" -o \\\"${path}\\\" "`;

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "downloadJson");
    }

    downloadFile(url: string, path: string): Promise<boolean> {
        console.log(" >> Downloading file from:\n" + url);

        const curlPath = "C:\\\\bin\\\\curl";
        let maxscript = `cmdexRun "${curlPath} -k -s -H \\\"Accept: application/octet-stream\\\" \\\"${url}\\\" -o \\\"${path}\\\" "`;

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "downloadFile");
    }

    extractZip(fullpath: string, destDir: string): Promise<boolean> {
        console.log(" >> Extracting file from:\n" + fullpath);

        const _7zPath = "7z";
        let maxscript = `cmdexRun "${_7zPath} e -aoa ${fullpath} -o${destDir}"`;

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "downloadFile");
    }

    uploadFile(url: string, path: string): Promise<boolean> {
        console.log(" >> Uploading file to:\n" + url);

        let escapedFilename = path.replace(/\\/g, "\\\\");

        const curlPath = "C:\\\\bin\\\\curl";
        let maxscript = `cmdexRun "${curlPath} -F file=@${escapedFilename} ${url}" `;

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "uploadFile");
    }

    importMesh(path: string, nodeName: string): Promise<boolean> {
        console.log(" >> importing mesh from ", path);
        let maxscript = `threejsImportBufferGeometry \"${path}\" \"${nodeName}\"`;

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "importMesh");
    }

    exportMesh(path: string, nodeName: string, uuid: string): Promise<boolean> {
        console.log(" >> exporting mesh to ", path);
        let maxscript = `threejsExportBufferGeometry \"${path}\" \"${nodeName}\" \"${uuid}\"`;

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "exportMesh");
    }

    assignMaterial(nodeName: string, materialName: string): Promise<boolean> {
        let maxscript = `mat = rayysFindMaterialByName "${materialName}"; `
                        + `if (mat != false) then (`
                        + `  $${nodeName}.Material = mat`
                        + `) `;

        return this.execMaxscript(maxscript, "assignMaterial");
    }

    assignMultiSubMaterial(nodeName, materialNames): Promise<boolean> {

        const numSubs = materialNames.length;
        if (numSubs === 0) {
            console.log(` WARN | Can't create multi-sub material with zero subs: `, nodeName, materialNames);
            return Promise.resolve(true);
        }

        const materialName = "multiSub_" + md5( materialNames.map(el => el ? el : "<empty>").join("_") ).substr(0,6).toUpperCase();
        console.log(` >> assignMultiSubMaterial\n    nodeName: `, nodeName, 
                                              `\n    materialNames: `, materialNames, 
                                              `\n    materialName (hash): `, materialName);

        let maxscript = `mat = rayysFindMaterialByName "${materialName}" ;\n` 

                        + `if (mat != false) then (\n`
                        + `  $${nodeName}.Material = mat ;\n`
                        + `) else (\n`
                        + `  mat = multiSubMaterial numsubs: ${numSubs} ;\n`

                        +    (materialNames.map( (matName, matIdx) => {
                               return (
                                  `  submat = rayysFindMaterialByName "${matName}" ;\n`
                                + `  if (submat != false) then (\n`
                                + `    mat.materialList[${matIdx+1}] = submat ;\n`
                                + `  )\n` )
                              }) //== end of .map
                              .join("\n"))

                        + `  $${nodeName}.Material = mat ;\n`

                        + `) ` //== end of else

        console.log(` >> xor 1 maxscript: \n`, maxscript, "\n\n");

        return this.execMaxscript(maxscript, "assignMultiSubMaterial");
    }

    unwrapUV2(nodeName: string): Promise<boolean> {
        let maxscript = `rayysFlattenUV2 $${nodeName}`;

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "unwrapUv2");
    }

    renderScene(camera: string, size: number[], filename: string, renderSettings: any): Promise<boolean> {

        let escapedFilename = filename.replace(/\\/g, "\\\\");

        let maxscript =   ` pngio.settype(#true24) ;\r\n`  // enums: {#paletted|#true24|#true48|#gray8|#gray16} 
                        + ` pngio.setAlpha false ;\r\n`
                        + ` vr = renderers.current ;\r\n`;

        for (let k in renderSettings) {
            maxscript = maxscript + ` vr.${k} = ${renderSettings[k]} ; \r\n`
        }

        maxscript = maxscript 
                        + ` viewport.setLayout #layout_1 ;\r\n`
                        + ` viewport.setCamera $${camera} ;\r\n`
                        + ` renderWidth  = ${size[0]} ;\r\n`
                        + ` renderHeight = ${size[1]} ;\r\n`
                        + ` rendUseActiveView = true ;\r\n`
                        + ` rendSaveFile = true ;\r\n`
                        + ` rendOutputFilename = "${escapedFilename}" ;\r\n`
                        + ` max quick render ;\r\n`
                        + ` cmdexRun "C:\\\\bin\\\\curl.exe -F file=@${escapedFilename} ${this._settings.current.publicUrl}/v1/renderoutput" `;

        // see here: http://help.autodesk.com/view/3DSMAX/2018/ENU/?guid=__files_GUID_9175301C_13E6_488B_ABA6_D27CD804B205_htm
        // can also use: JPEG.setQuality(5); JPEG.setSmoothing(1);

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "renderScene");
    }

    bakeTextures(bakeObjectName: string, size: number, filenames: IBakeTexturesFilenames, renderSettings: any): Promise<boolean> {
        let escapedLightmap  = filenames.lightmap.replace(/\\/g, "\\\\");

        let maxscript =   ` pngio.settype(#true24) ;\r\n`  // enums: {#paletted|#true24|#true48|#gray8|#gray16} 
                        + ` pngio.setAlpha false ;\r\n`
                        + ` vr = renderers.current ;\r\n`;

        for (let k in renderSettings) {
            maxscript = maxscript + ` vr.${k} = ${renderSettings[k]} ; \r\n`
        }

        maxscript = maxscript 
                        + ` viewport.setLayout #layout_1 ;\r\n`
                        + ` size = ${size} ;\r\n`
                        + ` outputNames = #( \"${escapedLightmap}\" ) ;\r\n`
                        + ` rayysBakeVrayLightShadowMaps $${bakeObjectName} outputNames size ;\r\n`
                        + ` select $${bakeObjectName} ; \r\n`
                        + ` render rendertype:#bakeSelected vfb:on progressBar:true outputSize:[size,size] ;\r\n`
                        + ` cmdexRun "C:\\\\bin\\\\img_morphology.exe 2 2 0 \\\"${escapedLightmap}\\\" \\\"${escapedLightmap}\\\"" ;\r\n`
                        + ` cmdexRun "C:\\\\bin\\\\curl.exe -F file=@${escapedLightmap} https://acc.renderfarmjs.com/v1/renderoutput" `

        // see here: http://help.autodesk.com/view/3DSMAX/2018/ENU/?guid=__files_GUID_9175301C_13E6_488B_ABA6_D27CD804B205_htm
        // can also use: JPEG.setQuality(5); JPEG.setSmoothing(1);

        console.log(" >> maxscript: " + maxscript);

        return this.execMaxscript(maxscript, "bakeTextures");
    }
}

export { MaxscriptClient };
