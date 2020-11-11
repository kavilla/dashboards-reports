/*
 * Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { schema } from '@kbn/config-schema';
import {
  IRouter,
  IKibanaResponse,
  ResponseError,
  Logger,
  ILegacyScopedClusterClient,
} from '../../../../src/core/server';
import { API_PREFIX } from '../../common';
import { createReport } from './lib/createReport';
import { reportSchema } from '../model';
import { errorResponse } from './utils/helpers';
import { DELIVERY_TYPE } from './utils/constants';
import {
  backendToUiReport,
  backendToUiReportsList,
} from './utils/converters/backendToUi';

export default function (router: IRouter) {
  // generate report
  router.post(
    {
      path: `${API_PREFIX}/generateReport`,
      validate: {
        body: schema.any(),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IKibanaResponse<any | ResponseError>> => {
      //@ts-ignore
      const logger: Logger = context.reporting_plugin.logger;
      let report = request.body;
      // input validation
      try {
        report.report_definition.report_params.core_params.origin =
          request.headers.origin;
        report = reportSchema.validate(report);
      } catch (error) {
        logger.error(`Failed input validation for create report ${error}`);
        return response.badRequest({ body: error });
      }

      try {
        const reportData = await createReport(request, context, report);

        // if not deliver to user himself , no need to send actual file data to client
        const delivery = report.report_definition.delivery;
        if (
          delivery.delivery_type === DELIVERY_TYPE.kibanaUser &&
          delivery.delivery_params.kibana_recipients.length === 0
        ) {
          return response.ok({
            body: {
              data: reportData.dataUrl,
              filename: reportData.fileName,
            },
          });
        } else {
          return response.ok();
        }
      } catch (error) {
        // TODO: better error handling for delivery and stages in generating report, pass logger to deeper level
        logger.error(`Failed to generate report: ${error}`);
        logger.error(error);
        return errorResponse(response, error);
      }
    }
  );

  // generate report from id
  router.post(
    {
      path: `${API_PREFIX}/generateReport/{reportId}`,
      validate: {
        params: schema.object({
          reportId: schema.string(),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IKibanaResponse<any | ResponseError>> => {
      //@ts-ignore
      const logger: Logger = context.reporting_plugin.logger;

      try {
        const savedReportId = request.params.reportId;
        // @ts-ignore
        const esReportsClient: ILegacyScopedClusterClient = context.reporting_plugin.esReportsClient.asScoped(
          request
        );
        // get report
        const esResp = await esReportsClient.callAsCurrentUser(
          'es_reports.getReportById',
          {
            reportInstanceId: savedReportId,
          }
        );
        // convert report to use UI model
        const report = backendToUiReport(esResp.reportInstance);
        // generate report
        const reportData = await createReport(
          request,
          context,
          report,
          savedReportId
        );

        return response.ok({
          body: {
            data: reportData.dataUrl,
            filename: reportData.fileName,
          },
        });
      } catch (error) {
        logger.error(`Failed to generate report by id: ${error}`);
        logger.error(error);
        return errorResponse(response, error);
      }
    }
  );

  // get all reports details
  router.get(
    {
      path: `${API_PREFIX}/reports`,
      validate: {
        query: schema.object({
          size: schema.maybe(schema.string()),
          sortField: schema.maybe(schema.string()),
          sortDirection: schema.maybe(schema.string()),
          fromIndex: schema.maybe(schema.string()),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IKibanaResponse<any | ResponseError>> => {
      const { fromIndex } = request.query as {
        size: string;
        sortField: string;
        sortDirection: string;
        fromIndex: string;
      };

      try {
        // @ts-ignore
        const esReportsClient: ILegacyScopedClusterClient = context.reporting_plugin.esReportsClient.asScoped(
          request
        );

        const esResp = await esReportsClient.callAsCurrentUser(
          'es_reports.getReports',
          {
            fromIndex: fromIndex,
          }
        );

        const reportsList = backendToUiReportsList(esResp.reportInstanceList);

        return response.ok({
          body: {
            data: reportsList,
          },
        });
      } catch (error) {
        //@ts-ignore
        context.reporting_plugin.logger.error(
          `Failed to get reports details: ${error}`
        );
        return errorResponse(response, error);
      }
    }
  );

  // get single report details by id
  router.get(
    {
      path: `${API_PREFIX}/reports/{reportId}`,
      validate: {
        params: schema.object({
          reportId: schema.string(),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IKibanaResponse<any | ResponseError>> => {
      try {
        // @ts-ignore
        const esReportsClient: ILegacyScopedClusterClient = context.reporting_plugin.esReportsClient.asScoped(
          request
        );

        const esResp = await esReportsClient.callAsCurrentUser(
          'es_reports.getReportById',
          {
            reportInstanceId: request.params.reportId,
          }
        );

        const report = backendToUiReport(esResp.reportInstance);

        return response.ok({
          body: report,
        });
      } catch (error) {
        //@ts-ignore
        context.reporting_plugin.logger.error(
          `Failed to get single report details: ${error}`
        );
        return errorResponse(response, error);
      }
    }
  );
}
