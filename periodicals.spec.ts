import * as qc from "@shah/queryable-content";
import * as pipe from "@shah/ts-pipe";
import * as atc from "@shah/tsn-content-classification-html-anchors";
import * as atcRulesCommon from "@shah/tsn-content-classification-html-anchors/dist/html-anchor-text-classification-rules-common";
import { Expect, SetupFixture, Test, TestFixture } from "alsatian";
import mime from "whatwg-mimetype";
import * as p from "./periodicals";

export interface EmailSupplierContent {
    messageId: string;
    fromAddress: string;
    fromName: string;
    date: string;
    subject: string;
    htmlContent: string
}

export interface EmailPeriodicalEdition extends p.PeriodicalEdition {
    readonly subject: string;
}

@TestFixture("Periodicals Manager")
export class EmailTestSuite {
    readonly contentTr: qc.ContentTransformer = pipe.pipe(qc.EnrichQueryableHtmlContent.singleton);
    readonly testEmails: EmailSupplierContent[] = require("./email-supplier-test-content.json");
    readonly atcRulesEngine = new atc.TypicalAnchorTextRuleEngine(atcRulesCommon.commonRules);
    readonly atcClassifier = atc.TypicalAnchorTextClassifier.singleton;
    readonly supplier = new p.TypicalPeriodicalSupplier("email://test", this.atcRulesEngine, this.atcClassifier);
    readonly stats = {
        editionsEncountered: 0,
        periodicalsEncountered: 0,
        editionAnchorsEncountered: 0,
    }

    constructor() {
    }

    @SetupFixture
    public async classifyEmailNewsletters(): Promise<void> {
        const periodicalsEncountered: { [name: string]: p.Periodical } = {};
        for (const email of this.testEmails) {
            let periodical = this.supplier.registerPeriodical(`${email.fromName} <${email.fromAddress}>`);
            if (!periodicalsEncountered[periodical.name]) {
                periodicalsEncountered[periodical.name] = periodical;
                this.stats.periodicalsEncountered++;
            }
            const date = new Date(email.date);
            const content = await this.contentTr.flow({
                htmlSource: email.htmlContent,
                uri: `email://${email.messageId}/${email.fromAddress}/${email.fromName}/${date.toISOString()}/${email.subject}`
            }, {
                contentType: "text/html",
                mimeType: new mime("text/html"),
            }) as qc.QueryableHtmlContent;
            const anchors: p.ClassifiedAnchor[] = [];
            content.anchors().map((anchor) => {
                anchors.push(periodical.registerAnchor(anchor))
            });
            this.stats.editionAnchorsEncountered += anchors.length;
            const pe: EmailPeriodicalEdition = {
                supplierContentId: email.messageId,
                fromAddress: email.fromAddress,
                fromName: email.fromName,
                date: date,
                anchors: anchors,
                subject: email.subject,
            }
            periodical.registerEdition(pe);
            this.stats.editionsEncountered++;
        }
        await this.supplier.classifyAnchors();
        this.stats.periodicalsEncountered = Object.keys(periodicalsEncountered).length;
    }

    @Test("Ensure test content is available")
    public testEmailNewslettersSupplierCount(): void {
        Expect(this.testEmails.length).toBe(1191);
    }

    @Test("Ensure periodicals count is valid")
    public testPeriodicalsCount(): void {
        Expect(Object.keys(this.supplier.periodicals).length).toBe(this.stats.periodicalsEncountered);
    }

    @Test("Ensure periodicals count is valid")
    public testPeriodicalEditionsCount(): void {
        let count = 0;
        Object.values(this.supplier.periodicals).forEach(p => count += p.editions.length);
        Expect(count).toBe(this.stats.editionsEncountered);
    }

    @Test("Ensure periodicals editions anchors count is valid")
    public testPeriodicalEditionsAnchorsCount(): void {
        let count = 0;
        Object.values(this.supplier.periodicals).forEach(p => p.editions.forEach(pe => count += pe.anchors.length));
        Expect(count).toBe(this.stats.editionAnchorsEncountered);
    }
}
