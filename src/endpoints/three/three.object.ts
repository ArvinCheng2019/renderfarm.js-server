import { injectable, inject } from "inversify";
import * as express from "express";
import { IEndpoint, IDatabase, ISettings, ISessionService, SessionServiceEvents, ISessionPool, IThreeMaxscriptBridge, PostSceneResult } from "../../interfaces";
import { TYPES } from "../../types";
import { Session } from "../../database/model/session";

const LZString = require("lz-string");

@injectable()
class ThreeObjectEndpoint implements IEndpoint {
    private _settings: ISettings;
    private _sessionService: ISessionService;
    private _threeMaxscriptBridgePool: ISessionPool<IThreeMaxscriptBridge>;

    private _objects: { [sessionGuid: string]: any; } = {};

    constructor(@inject(TYPES.ISettings) settings: ISettings,
        @inject(TYPES.ISessionService) sessionService: ISessionService,
        @inject(TYPES.IThreeMaxscriptBridgePool) threeMaxscriptBridgePool: ISessionPool<IThreeMaxscriptBridge>,
    ) {
        this._settings = settings;
        this._sessionService = sessionService;
        this._threeMaxscriptBridgePool = threeMaxscriptBridgePool;

        this._sessionService.on(SessionServiceEvents.Closed, this.onSessionClosed.bind(this));
        this._sessionService.on(SessionServiceEvents.Expired, this.onSessionClosed.bind(this));
        this._sessionService.on(SessionServiceEvents.Failed, this.onSessionClosed.bind(this));
    }

    private onSessionClosed(session: Session) {
        delete this._objects[session.guid];
    }

    bind(express: express.Application) {
        express.get(`/v${this._settings.majorVersion}/three/:uuid`, async function (this: ThreeObjectEndpoint, req, res) {
            console.log(`GET on ${req.path}`);

            let uuid = req.params.uuid;
            for (let i in this._objects) {
                let sceneJson = this._objects[i];
                if (sceneJson.object.uuid === uuid) {
                    res.status(200);
                    res.end(JSON.stringify(sceneJson));
                    return;
                }
            }

            res.status(404);
            res.end(JSON.stringify({ ok: false, message: "no scene with given uuid found", error: null }, null, 2));
        }.bind(this));

        express.post(`/v${this._settings.majorVersion}/three`, async function (this: ThreeObjectEndpoint, req, res) {
            let sessionGuid = req.body.session_guid;
            console.log(`POST on ${req.path} with session: ${sessionGuid}`);

            req.connection.setTimeout(15 * 60 * 1000); // 15 min

            // check that session is actually open
            let session: Session = await this._sessionService.GetSession(sessionGuid, false, false, true);
            if (!session) {
                return;
            }

            // check that session has no active job, i.e. it is not being rendered
            //if (session.workerRef && session.workerRef.jobRef) {
            //    res.status(403);
            //    res.end(JSON.stringify({ ok: false, message: "changes forbidden, session is being rendered", error: null }, null, 2));
            //    return;
            //}

            let compressedJson = req.body.compressed_json; // this is to create scene or add new obejcts to scene
            if (!compressedJson) {
                res.status(400);
                res.end(JSON.stringify({ ok: false, message: "missing compressed_json", error: null }, null, 2));
                return;
            }

            let sceneJsonText = LZString.decompressFromBase64(compressedJson);
            let sceneJson: any = JSON.parse(sceneJsonText);

            console.log(` >> received scene: `, JSON.stringify(sceneJson, null, 2));

            if (!this.validateObjectJson(sceneJson, res)) {
                return;
            }

            // cache it now
            if (!this._objects[session.guid]) {
                this._objects[session.guid] = sceneJson;
            }

            let bridge = await this._threeMaxscriptBridgePool.Get(session);
            let postSceneResult: PostSceneResult;
            try {
                postSceneResult = await bridge.PostScene(session, sceneJson);
            } catch (err) {
                console.log(" >> bridge.PostScene failed: ", err);

                res.status(500);
                res.end(JSON.stringify({ ok: false, message: "failed to post scene to 3ds max", error: err.message }, null, 2));
                return;
            }

            res.status(201);
            res.end(JSON.stringify({ ok: true, type: "three", data: { uuid: sceneJson.object.uuid, unwrapped_geometry: postSceneResult.UnwrappedGeometry } }));
        }.bind(this));

        express.put(`/v${this._settings.majorVersion}/three/:uuid`, async function (this: ThreeObjectEndpoint, req, res) {
            let sessionGuid = req.body.session_guid;
            console.log(`PUT on ${req.path} with session: ${sessionGuid}`);

            // check that session is actually open
            let session: Session = await this._sessionService.GetSession(sessionGuid, false, false);
            if (!session) {
                return;
            }

            // check that session has no active job, i.e. it is not being rendered
            if (session.workerRef && session.workerRef.jobRef) {
                res.status(403);
                res.end(JSON.stringify({ ok: false, message: "changes forbidden, session is being rendered", error: null }, null, 2));
                return;
            }

            let compressedJson = req.body.compressed_json; // this is to create scene or add new obejcts to scene
            if (!compressedJson) {
                res.status(400);
                res.end(JSON.stringify({ ok: false, message: "missing compressed_json", error: null }, null, 2));
                return;
            }

            let objectJsonText = LZString.decompressFromBase64(compressedJson);
            let objectJson: any = JSON.parse(objectJsonText);

            if (!this.validateObjectJson(objectJson, res)) {
                return;
            }

            let cachedScene = this._objects[session.guid];
            if (!cachedScene) {
                res.status(404);
                res.end(JSON.stringify({ ok: false, message: "resource not found", error: null }, null, 2));
                return;
            }

            let bridge = await this._threeMaxscriptBridgePool.Get(session);
            try {
                await bridge.PutObject(objectJson);
            } catch (err) {
                console.log(" >> bridge.PutObject failed: ", err);

                res.status(500);
                res.end(JSON.stringify({ ok: false, message: "failed to put object to 3ds max", error: err.message }, null, 2));
                return;
            }

            res.status(200);
            res.end(JSON.stringify({ ok: true, type: "three", data: { uuid: objectJson.object.uuid } }));
        }.bind(this));

        express.delete(`/v${this._settings.majorVersion}/three/:uuid`, async function (this: ThreeObjectEndpoint, req, res) {
            let sessionGuid = req.body.session_guid;
            console.log(`DELETE on ${req.path} with session: ${sessionGuid}`);

            let uuid = req.params.uuid;
            console.log(`todo: // delete material ${uuid}`);

            res.status(200);
            res.end(JSON.stringify({}));
        }.bind(this));
    }

    private validateObjectJson(objectJson, res): boolean {

        if (!objectJson.metadata) {
            res.status(400);
            res.end(JSON.stringify({ ok: false, message: "object missing metadata", error: null }, null, 2));
            return false;
        }

        if (objectJson.metadata.version !== 4.5) {
            res.status(400);
            res.end(JSON.stringify({ ok: false, message: "object version not supported (expected 4.5)", error: null }, null, 2));
            return false;
        }

        if (objectJson.metadata.type !== "Object") {
            res.status(400);
            res.end(JSON.stringify({ ok: false, message: "object type not supported, expected 'Object'", error: null }, null, 2));
            return false;
        }

        if (objectJson.metadata.generator !== "Object3D.toJSON") {
            res.status(400);
            res.end(JSON.stringify({ ok: false, message: "unexpected generator, expected 'Object3D.toJSON'", error: null }, null, 2));
            return false;
        }

        if (!objectJson.object) {
            res.status(400);
            res.end(JSON.stringify({ ok: false, message: "object is missing", error: null }, null, 2));
            return false;
        }

        return true;
    }
}

export { ThreeObjectEndpoint };
