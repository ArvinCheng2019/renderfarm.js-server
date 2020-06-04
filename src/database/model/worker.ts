import { IDbEntity } from "./base/IDbEntity";
import { Session } from "./session";
import { Job } from "./job";

export class Worker extends IDbEntity {
    public guid: string;
    public mac: string;
    public ip: string;
    public port: number;
    public endpoint: string;
    public workgroup: string;
    public firstSeen: Date;
    public lastSeen: Date;
    public vrayProgress: string;
    public cpuUsage: number;
    public ramUsage: number;
    public totalRam: number;
    public sessionGuid: string;

    public sessionRef: Session;
    public jobRef: Job;

    constructor(obj: any) {
        super();
        if (obj) {
            this.parse(obj);
        }
    }

    public parse(obj: any) {
        this.guid      = obj.guid;
        this.mac       = obj.mac;
        this.ip        = obj.ip;
        this.port      = obj.port;
        this.endpoint  = `${obj.ip}:${obj.port}`;
        this.workgroup = obj.workgroup;
        this.firstSeen = obj.firstSeen ? new Date(obj.firstSeen) : undefined;
        this.lastSeen  = obj.lastSeen ? new Date(obj.lastSeen) : undefined;
        this.vrayProgress = obj.vrayProgress ? obj.vrayProgress : null;
        this.cpuUsage  = obj.cpuUsage;
        this.ramUsage  = obj.ramUsage;
        this.totalRam  = obj.totalRam;
        this.sessionGuid = obj.sessionGuid;
    }

    public toJSON() {
        let result: any = {
            guid:      this.guid,
            mac:       this.mac,
            ip:        this.ip,
            port:      this.port,
            endpoint:  `${this.ip}:${this.port}`,
            workgroup: this.workgroup,
            firstSeen: this.firstSeen,
            lastSeen:  this.lastSeen,
            vrayProgress: this.vrayProgress,
            cpuUsage:  this.cpuUsage,
            ramUsage:  this.ramUsage,
            totalRam:  this.totalRam,
            sessionGuid: this.sessionGuid
        };

        return this.dropNulls(result);
    }

    public get filter(): any {
        return {
            guid:       this.guid
        }
    }
}
